/**
 * 定位锚点：内存中的活对象，形态由各格式的文档源决定。
 * 切分器只负责搬运，不解释其内容；编码成可持久化的定位串由 LocatorCodec 完成。
 */
export type AnchorPoint = unknown;

/**
 * 可检索文本的最小单元。
 * start / end 为 null 表示这是为保留段落语义而插入的换行，不对应文档中的真实位置。
 */
export interface TextUnit {
  /** 已归一化的文本内容 */
  value: string;
  /** 单元起始锚点 */
  start: AnchorPoint | null;
  /** 单元结束锚点，指向最后一个字符之后 */
  end: AnchorPoint | null;
}

/** 一个可独立定位的文档单元：EPUB 是 spine section，PDF 是页，HTML 是文件或标题段。 */
export interface SegmentInfo {
  /** 单元在阅读顺序中的下标 */
  index: number;
  /** 单元的稳定标识（EPUB 是 section id/href，PDF 是页号） */
  id: string;
  /** 单元级兜底定位串：分片内取不到有效锚点时使用 */
  fallbackLocator: string;
}

/**
 * 文档源：唯一知道「格式」的地方。
 *
 * 只回答三件事——有哪些单元、单元的文字在哪、某个位置怎么写下来；
 * 不决定怎么切分，也不接触数据库，因此可脱离 Electron 与 SQLite 单独测试。
 */
export interface DocumentSource<TSegment extends SegmentInfo = SegmentInfo> {
  /** 枚举阅读顺序上的全部文档单元 */
  listSegments(): Promise<TSegment[]>;
  /** 取一个单元的可检索文本单元；锚点必须在本次调用返回的文档仍然有效时编码 */
  loadTextUnits(segment: TSegment): Promise<TextUnit[]>;
  /** 把内存锚点编码成持久化定位串；编码不出时返回 null，由编排层降级到单元级定位 */
  encodeLocator(segment: TSegment, anchor: AnchorPoint): string | null;
}

/** 在 TextUnit 数组中的半开区间：先确定切分边界，再生成正文和定位串。 */
export interface ChunkRange {
  /** 区间起始单元下标，含 */
  startIndex: number;
  /** 区间结束单元下标，不含 */
  endIndex: number;
}

/** 切分参数，单位均为文本单元数（CJK 与拉丁文都按码点切分，等价于字符数）。 */
export interface ChunkOptions {
  /** 目标长度 */
  targetLength: number;
  /** 自然边界下限，低于它就不再向前回退 */
  minLength: number;
  /** 硬上限，超过它必须断开 */
  maxLength: number;
  /** 相邻分片的重叠长度 */
  overlapLength: number;
}

/**
 * 切分产物：写入 book_chunk 前的中间态。
 *
 * 格式无关，也不含 bookId 与主键——「分片存在哪」属于落库映射的职责。
 * 只带一个 segmentIndex，因此跨单元的分片在类型上就无法表达。
 */
export interface ChunkDraft {
  /** 所属文档单元在阅读顺序中的下标 */
  segmentIndex: number;
  /** 所属文档单元的稳定标识 */
  segmentId: string;
  /** 单元内的分片序号，与区间下标一致，内容为空的分片会留下空号 */
  chunkIndex: number;
  /** 清理后的正文，直接作为 BM25 的检索文档 */
  content: string;
  /** 起始定位串，自带 scheme 前缀 */
  locatorStart: string;
  /** 结束定位串，自带 scheme 前缀 */
  locatorEnd: string;
}
