使用百度的 PaddleOCR 官方 API，走官方 TypeScript SDK（`@paddleocr/api-sdk`）。

参考文档 https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/serving/paddleocr_official_api/typescript.md

## 代码结构

- `etl/ocr/result.ts`：**与引擎无关**的结果（`OcrPageResult` / `OcrTextBlock` / `OcrImage`）与插图合并规则；
- `etl/ocr/paddle/client.ts`：请求侧，认识 SDK 与 job 状态；
- `etl/ocr/paddle/parser.ts`：响应侧，**唯一**认识 `prunedResult` / `markdownImages` / 服务端标签的地方；
- `books/ocr-runner.ts`：编排（切片、并发、落库、附件、自动分片），不 import 任何 SDK 类型。

换识别服务时只改 `paddle/` 下的两个文件，业务代码只认 `OcrPageResult`。

## 为什么分块

接口是「一个 job 一个文件」，`pageRanges` 只限制处理范围、**不会少传文件**。所以按页段提交反而会把整本书重复上传 N 遍。

真正能分块的前提是本地切文件：用 pdf-lib 按页拷贝（文本层、矢量、字体原样保留，不重渲染），每块单独提交。

- 每块页数：`ocr.pageSize`；
- 同时提交块数：`ocr.concurrency`；
- 块文件放 `data/ocr-work/<bookId>/`，任务结束整目录删除。

## 流程

```
split → 并发提交 → 轮询 → 映射 → 下载插图并登记附件 → 逐块事务落库 → 自动分片
```

- **绝对页号 = 块起始页 + 结果下标**。接口不返回绝对页码，分块上传时必须自己换算。
- **进度**：块内用服务端的 `extractedPages`，整体用「已落库页数 / 总页数」。
- **断点**：每块一个事务；重新开始时跳过已经完整落库的块，未完成的重新提交。
- **取消**：只在块边界生效，在飞的块跑完并落库；服务端任务本身停不掉。
- **失败**：整块重试（最多三次），鉴权 / 文件不存在不重试；失败原因写 `book_stage.ocr.last_error`。

## 块与图片

- 页眉（`header`）、页脚（`footer`）、页码（`number`）在映射阶段直接丢弃；
- 表格块保留 HTML，分片直接用 OCR 的结果，不在读取时改写；
- 插图来自 `markdownImages`，键名形如 `imgs/img_in_seal_box_352_336_497_541.jpg`，
  `_box_<x1>_<y1>_<x2>_<y2>` 就是它在页面上的位置；用它把图片块插回阅读顺序
  （优先插在包含它中心的块之后）；
- 图片当场下载（签名地址会过期），**原样**登记为附件（`storeImageOriginal`，不压缩），
  块里存 `attachmentId` 与 bbox，展示走 `app://attachment-resource/<id>`；
- 每个块都保留 `bbox`（`[x1, y1, x2, y2]`，服务端识别时的页面像素坐标），
  存在 `book_page.blocks` 的 JSON 里，供将来做版面还原或定位。

## 分片

识别完成后读 `book_page`，每页拼成纯文本，复用文字层 PDF 的文档源切分，
定位串仍是 `pdf:<页>`——OCR 书和文字层书没有第二条分片路径。

## 表

`book_page`：`(book_id, page)` 主键，`blocks` 是 `BookPageBlock[]` 的 JSON。
行存在即表示该页已识别，空块表示空白页，没有状态列。
