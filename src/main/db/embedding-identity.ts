/**
 * 向量存储的物理约定：表名、维度校验、字节布局。
 *
 * 模型身份（地址归一化、指纹）**不在这里**——它两端共用，见 `@shared/utils/embedding-identity`。
 * 这里只关心「拿到一个指纹之后，向量怎么落盘」。
 */

/** 每个向量占用的字节数（Float32）。 */
const BYTES_PER_ELEMENT = 4;

/**
 * 维度合理区间，用来挡掉接口返回的异常值。
 * 下限取得比常见的最小文本模型（384 维）低得多，上限覆盖主流大模型。
 */
export const MIN_EMBEDDING_DIMENSION = 64;
export const MAX_EMBEDDING_DIMENSION = 8192;

/** 一张向量表涉及的两个标识符。 */
export interface VectorTableNames {
  /** 存向量的表名 */
  tableName: string;
  /** 按资源聚合与级联删除用的索引名 */
  sourceIndexName: string;
}

/** 表名后缀取多少位十六进制字符。16 位即 64 bit，碰撞概率可以忽略。 */
const TABLE_SUFFIX_LENGTH = 16;

/**
 * 生成向量表名：`embed_vec_<维度>_<指纹前16位>`。
 *
 * 后缀取指纹而不是 `embed_index` 的自增 id，换来两件事：
 *
 * - **首次建表不必先插记录拿 id**。维度一确定就能算出表名，于是「建表 → 注册索引 → 写向量」
 *   可以在同一个事务里按自然顺序完成，不会出现孤儿表。
 * - **幂等**。同一套模型参数永远得到同一个表名，注册失败重试也不会多出一张表。
 */
export function buildVectorTableNames(dimension: number, fingerprint: string): VectorTableNames {
  assertValidDimension(dimension);
  const tableName = `embed_vec_${dimension}_${tableSuffix(fingerprint)}`;
  return { tableName, sourceIndexName: `${tableName}_source_idx` };
}

/** 从指纹里取一段十六进制做后缀。只保留合法字符，从构造上排除注入。 */
function tableSuffix(fingerprint: string): string {
  const hex = fingerprint
    .replace(/^sha256:/, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
  if (hex.length < TABLE_SUFFIX_LENGTH) {
    throw new Error(`模型指纹格式不合法，无法生成表名：${fingerprint}`);
  }
  return hex.slice(0, TABLE_SUFFIX_LENGTH);
}

/** 校验维度是否落在合理区间，不合法时抛错。 */
export function assertValidDimension(dimension: number): void {
  if (!Number.isInteger(dimension)) {
    throw new Error(`向量维度必须是整数，实际为 ${dimension}`);
  }
  if (dimension < MIN_EMBEDDING_DIMENSION || dimension > MAX_EMBEDDING_DIMENSION) {
    throw new Error(
      `向量维度 ${dimension} 超出合理区间 [${MIN_EMBEDDING_DIMENSION}, ${MAX_EMBEDDING_DIMENSION}]`
    );
  }
}

/**
 * 把浮点数组编码成向量表要求的 BLOB（连续小端 Float32）。
 *
 * 全项目只有这一处定义字节布局。布局写错不会报错，只会让检索距离静默算错，
 * 所以这里顺带校验长度与数值合法性。
 */
export function encodeVector(values: readonly number[], dimension: number): Buffer {
  if (values.length !== dimension) {
    throw new Error(`向量维度不符：期望 ${dimension}，实际 ${values.length}`);
  }
  const buffer = Buffer.allocUnsafe(dimension * BYTES_PER_ELEMENT);
  for (let i = 0; i < dimension; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      throw new Error(`向量第 ${i} 个分量不是有限数值：${value}`);
    }
    buffer.writeFloatLE(value, i * BYTES_PER_ELEMENT);
  }
  return buffer;
}
