/** 当前支持的书类型。后续新增文件类型只需扩展这个联合类型 */
import type { FoliateBook } from '@/components/reader/foliate-types';

export type BookType = 'epub';

/** 封面图片的字节 + 扩展名。Blob 不能跨 IPC 传输，拆成这两个字段 */
export interface CoverImage {
  bytes: Uint8Array;
  ext: string;
}

// reader所需要的书的实体类型
export interface BookEntity {
  id: string; // 书籍的id
  metadata: BookMetadata; // 书籍的元信息
  type: BookType;
  // 目录（已展平的扁平结构，由 flattenToc 从 rawBook.toc 生成）
  tocs?: TOCItem[];
  // foliate-js 解析出的原始对象。运行时渲染需要的 sections/toc/metadata 等都从这里取
  rawBook: FoliateBook;
}

/**
 *
 *   eg
 *     {
 *       id: '0',
 *       title: '章节概要与阅读导图',
 *       level: 0,
 *       href: 'Fan_Cui_Ruo__Cong_Bu_Que_Ding_X_split_005.html'
 *        subitems: [Array]
 *     },
 *     {
 *       id: '1',
 *       title: '前言',
 *       level: 0,
 *       href: 'Fan_Cui_Ruo__Cong_Bu_Que_Ding_X_split_006.html'
 *     },
 */
export interface TOCItem {
  id: string;
  title: string;
  level: number; // 层级
  href?: string; // "EPUB/xhtml/Section0059.xhtml"
  subitems?: TOCItem[];
}

export interface BookMetadata {
  title: string;
  author?: string;
  cover: CoverImage | undefined;
  type: BookType;
}

/**
 * 一本书的向量化信息。
 *
 * 只描述**持久事实**：切成几片、几片有向量、这些向量是谁生成的、上次为什么停下。
 * 运行态（排队 / 向量化中 / 已暂停）不在这里——它只活在主进程内存里，见 EmbeddingRuntime。
 *
 * 「这本书该显示成未向量化还是已向量化」还要看用户当前选中了哪个模型，那是渲染层的判断：
 * 拿 modelFingerprint 和当前配置算出来的指纹比一次。后端不参与那个判断，
 * 否则换模型就得回写每本书的状态。
 */
export interface BookEmbedding {
  /** 需要向量化的分片总数 */
  total: number;
  /** 已有向量的分片数 */
  done: number;
  /** 生成这些向量的模型指纹；从没索引过时为 null */
  modelFingerprint: string | null;
  /** 最近一次停下的原因。任务开始时清空，所以它非空就等于「上次是失败停的」 */
  lastError: string | null;
}

/** 渲染端展示用的书籍实体 */
export interface BookDoc {
  id: string;
  booksName: string;
  booksType: BookType;
  coverUrl: string | null; // app开头的url
  totalPages: number | null;
  totalChapters: number | null;
  description: string | null;
  author: string | null;
  createdAt: number;
  /** 书籍源文件大小（字节）。文件缺失时为 null */
  fileSize: number | null;
  /** 向量化信息。永远是对象、不判空：没做过也是一种信息 */
  embedding: BookEmbedding;
}

/** 导入书籍响应（main 端完成 dialog + 解析 + 写库后返回） */
export interface BookImportResult {
  success: boolean;
  /** 用户取消选择时为 false 且无 error */
  canceled?: boolean;
  book?: BookDoc;
  error?: string;
}

/** 获取所有书籍响应 */
export interface BookListResult {
  success: boolean;
  books?: BookDoc[];
  error?: string;
}

/** 删除书籍请求 */
export interface BookDeleteRequest {
  /** 要删除的书籍 ID */
  id: string;
}

/** 删除书籍响应 */
export interface BookDeleteResult {
  success: boolean;
  error?: string;
}

/** 重新切分正文的响应 */
export interface BookRechunkResult {
  success: boolean;
  /** 重切之后的分片数，成功时存在 */
  total?: number;
  error?: string;
}

/** 获取书籍文件路径请求（阅读器打开书时使用） */
export interface BookGetRequest {
  id: string;
}

/** 选取封面图片响应：只返回图片字节供渲染层预览，由更新书籍时再落盘 */
export interface BookPickCoverResult {
  success: boolean;
  /** 用户取消选择时为 true 且无 error */
  canceled?: boolean;
  cover?: CoverImage;
  error?: string;
}

/**
 * 更新书籍信息请求。
 * 各字段省略表示不修改；author 传 null 表示清空作者；
 * cover 传 CoverImage 表示换成新封面，传 null 表示移除封面。
 */
export interface BookUpdateRequest {
  id: string;
  booksName?: string;
  author?: string | null;
  cover?: CoverImage | null;
}

/** 更新书籍信息响应 */
export interface BookUpdateResult {
  success: boolean;
  book?: BookDoc;
  error?: string;
}

/** 获取书籍文件路径响应 */
export interface BookGetResult {
  success: boolean;
  /** app:// 协议 URL，渲染端用 fetch 即可直接读取（替代旧的 IPC 读 buffer） */
  url?: string;
  /** 文件类型（冗余存储，避免前端再查 DB） */
  type?: BookType;
  error?: string;
}
