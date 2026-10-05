/**
 * 工具输出的截断工具。
 *
 * 两条独立限制，谁先触顶谁生效：
 * - 行数限制（默认 2000 行）
 * - 字节限制（默认 50KB）
 *
 * 超限时保留头部与尾部两段、省略中间，两段都是完整行，不返回半行内容。
 * 行数与字节限制各自对半分给头与尾；中间的省略提示由调用方插入，
 * 返回值里的 head 与 tail 是两段独立内容。
 */

/** 默认保留的最大行数 */
export const DEFAULT_MAX_LINES = 2000;

/** 默认保留的最大字节数 */
export const DEFAULT_MAX_BYTES = 50 * 1024;

/** 截断结果，供工具拼接续读提示、界面展示使用。 */
export interface TruncationResult {
  /** 头部保留的内容；未截断时即全文 */
  head: string;
  /** 尾部保留的内容；未截断或尾部一行都没放下时为空串 */
  tail: string;
  /** 是否发生了截断 */
  truncated: boolean;
  /** 因哪条限制被截断；未截断时为 null */
  truncatedBy: 'lines' | 'bytes' | null;
  /** 原始内容的总行数 */
  totalLines: number;
  /** 原始内容的总字节数 */
  totalBytes: number;
  /** 头部保留的行数 */
  headLines: number;
  /** 尾部保留的行数 */
  tailLines: number;
  /** 中间省略的行数 */
  omittedLines: number;
  /** 保留内容的总行数（头 + 尾） */
  outputLines: number;
  /** 保留内容的总字节数（头 + 尾，不含调用方插入的省略提示） */
  outputBytes: number;
  /** 首行单行就超出字节预算，头部一行都没放下 */
  firstLineExceedsLimit: boolean;
  /** 本次生效的行数限制 */
  maxLines: number;
  /** 本次生效的字节限制 */
  maxBytes: number;
}

/** 截断选项，省略时使用默认限制。 */
export interface TruncationOptions {
  /** 最大行数，默认 2000 */
  maxLines?: number;
  /** 最大字节数，默认 50KB */
  maxBytes?: number;
}

/** 按行拆分用于计数；结尾的换行不算作多出一行。 */
function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split('\n');
  if (content.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

/** 把字节数格式化成便于阅读的大小，用于拼接提示文本。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 头尾保留的截断：内容超限时保留头部若干行与尾部若干行，中间整段省略。
 * 头尾都吃满行数预算说明行数先触顶，否则是字节先触顶。
 * 首行单独超过字节预算时头部为空，此时 firstLineExceedsLimit 为 true。
 */
export function truncateHeadTail(
  content: string,
  options: TruncationOptions = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, 'utf-8');
  const lines = splitLines(content);
  const totalLines = lines.length;

  // 两条限制都没触顶，原样返回
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      head: content,
      tail: '',
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      headLines: totalLines,
      tailLines: 0,
      omittedLines: 0,
      outputLines: totalLines,
      outputBytes: totalBytes,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  // 行数与字节预算各自对半分给头与尾
  const headLineBudget = Math.ceil(maxLines / 2);
  const tailLineBudget = maxLines - headLineBudget;
  const headByteBudget = Math.ceil(maxBytes / 2);
  const tailByteBudget = maxBytes - headByteBudget;

  const headLines: string[] = [];
  let headBytes = 0;
  for (let i = 0; i < lines.length && headLines.length < headLineBudget; i++) {
    // 换行符本身占 1 字节，首行不计
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + (headLines.length > 0 ? 1 : 0);
    if (headBytes + lineBytes > headByteBudget) {
      break;
    }
    headLines.push(lines[i]);
    headBytes += lineBytes;
  }

  // 尾部从末尾往前收集，同理处理换行符
  const tailLines: string[] = [];
  let tailBytes = 0;
  for (let i = lines.length - 1; i >= 0 && tailLines.length < tailLineBudget; i--) {
    const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + (tailLines.length > 0 ? 1 : 0);
    if (tailBytes + lineBytes > tailByteBudget) {
      break;
    }
    tailLines.unshift(lines[i]);
    tailBytes += lineBytes;
  }

  return {
    head: headLines.join('\n'),
    tail: tailLines.join('\n'),
    truncated: true,
    truncatedBy:
      headLines.length === headLineBudget && tailLines.length === tailLineBudget
        ? 'lines'
        : 'bytes',
    totalLines,
    totalBytes,
    headLines: headLines.length,
    tailLines: tailLines.length,
    omittedLines: totalLines - headLines.length - tailLines.length,
    outputLines: headLines.length + tailLines.length,
    outputBytes: headBytes + tailBytes,
    firstLineExceedsLimit: headLines.length === 0,
    maxLines,
    maxBytes,
  };
}
