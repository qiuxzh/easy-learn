/** OCR 领域的共享类型：页块、运行态与事件。 */

/** 识别模型在界面上的展示名。 */
export const OCR_MODEL_LABEL = 'PaddleOCR-VL-1.6';

/**
 * 文字块类型（闭集）。
 *
 * 引擎标签一律映射到这里；映射不到的兜底成 text，不透传引擎词汇。
 * 页眉、页脚、页码在映射时被丢弃，所以不在这张表里。
 */
export type OcrTextBlockType =
  | 'text' // 正文段落
  | 'title' // 标题
  | 'caption' // 题注
  | 'table' // 表格，内容是 HTML
  | 'formula' // 公式
  | 'aside'; // 边注与脚注

/**
 * 页内矩形：[x1, y1, x2, y2]。
 *
 * 是识别引擎使用的页面像素坐标，不是渲染画布坐标。
 */
export type OcrRect = [number, number, number, number];

/** 一页里的一个块。图片块只记附件 id，不存文件路径。 */
export type BookPageBlock =
  | { type: OcrTextBlockType; text: string; bbox: OcrRect | null }
  | { type: 'image'; attachmentId: string; bbox: OcrRect | null };

/** 识别任务的运行阶段。 */
export type OcrPhase = 'running' | 'cancelling';

/**
 * 识别任务的运行态。
 *
 * 只在内存中，不持久化；未完成的页重新提交即可，不依赖这里恢复。
 */
export interface OcrRuntime {
  /** 正在识别哪本书 */
  bookId: string;
  phase: OcrPhase;
  /** 已经落库的页数 */
  done: number;
  /** 这本书的总页数 */
  total: number;
  /** 服务端已经处理完的页数（含还没落库的），用于让进度在块内也动起来 */
  extracted: number;
}

/** 命令类接口的统一返回。 */
export interface OcrCommandResult {
  success: boolean;
  /** 失败原因，成功时不存在 */
  error?: string;
}

/** 主进程推给渲染层的事件。 */
export type OcrEvent =
  /** 运行态变化；没有任务时为 null */
  | { kind: 'runtime'; runtime: OcrRuntime | null }
  /** 一次识别结束，界面据此重新拉取书籍 */
  | { kind: 'finished'; bookId: string; success: boolean; cancelled: boolean; error?: string };
