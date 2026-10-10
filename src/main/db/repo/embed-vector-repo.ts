import { getRawDatabase } from '..';
import { buildVectorTableNames, encodeVector } from '../embedding-identity';
import { assertVectorExtensionReady } from '../vector-extension';
import { VECTOR_DISTANCE } from '@shared/utils/embedding-identity';

/**
 * 可做向量化的资源类型。
 *
 * 定义在这里而不是 `schema/`：向量表是运行时建的，它的 DDL 就在本文件里，
 * 而这个类型描述的正是那张表 `source_type` 列的取值。当前只有书籍。
 */
export type EmbedSourceType = 'book' | 'flashcard';

/** 一张向量表的物理描述。维度随表走，写入时用它校验字节长度。 */
export interface VectorTableRef {
  tableName: string;
  dimension: number;
}

/** 待处理的分片：只有它当前的内容，不含任何向量。 */
export interface PendingChunk {
  chunkId: string;
  content: string;
}

/** 写入一行向量所需的数据。 */
export interface InsertVectorRow {
  chunkId: string;
  sourceId: string;
  sourceType: EmbedSourceType;
  /** Float32 紧凑排列的向量字节，长度必须等于 dimension * 4 */
  vector: Buffer;
}

/** 按资源聚合的数量。 */
export interface VectorCountBySource {
  sourceId: string;
  count: number;
}

/** 一次向量检索的命中。 */
export interface VectorSearchHit {
  /** 文档标识，对应向量表的 chunk_id */
  documentId: string;
  /** 与查询向量的距离，越小越相关；度量由向量空间的指纹决定 */
  distance: number;
}

/** 一行向量的字节数（Float32）。 */
const BYTES_PER_ELEMENT = 4;

/**
 * 向量列的列名与存储类型。
 * 建表、声明维度、扫描三处引用的必须是同一份，所以收成常量而不是各写一遍字面量。
 */
const VECTOR_COLUMN = 'vector';
const VECTOR_TYPE = 'FLOAT32';

/**
 * 本连接内已声明过维度的向量表。
 *
 * 声明是**连接级**的：扩展不把它落库，新开一条连接必须重新声明，否则扫描报
 * `vector_full_scan: unable to retrieve context`。所以这个 Set 的生命周期必须与连接一致——
 * 连接是模块级单例，Set 放在这里即与之同生共死。
 *
 * 一条要守住的不变式：**向量表被 DROP 重建后要清掉对应条目**，否则会沿用旧声明。
 */
const declaredTables = new Set<string>();

/**
 * 确保这张向量表在当前连接上已声明维度。
 *
 * 声明只在内存里生效、不落库（原因见 `../vector-extension` 的文件说明），
 * 所以每次启动后的第一次扫描都要补一次；`declaredTables` 只是让重复调用不再真的声明一遍。
 */
function ensureVectorIndex(ref: VectorTableRef): void {
  if (declaredTables.has(ref.tableName)) return;

  const options = `type=${VECTOR_TYPE},dimension=${ref.dimension},distance=${VECTOR_DISTANCE}`;
  getRawDatabase()
    .prepare('SELECT vector_init(?, ?, ?)')
    .get(ref.tableName, VECTOR_COLUMN, options);
  declaredTables.add(ref.tableName);
}

/** 一张向量表的总行数。扫描的 k 必须覆盖它，理由见 `searchBySource`。 */
function countAllRows(tableName: string): number {
  const row = getRawDatabase().prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

/**
 * 向量表的数据访问。
 *
 * 向量表是按模型在运行时创建的、表名不固定，drizzle 的静态 schema 表达不了，
 * 所以这里全部走原始 SQL。表名与索引名都由 `buildVectorTableNames` 从维度与指纹拼出，
 * 从构造上排除注入。扫描与维度声明由 `../vector-extension` 加载的 sqlite-vector 扩展提供。
 */
export class EmbedVectorRepo {
  /**
   * 确保某个模型的向量表存在，返回它的物理描述。
   *
   * 表名里带上维度：调试时看表名就知道维度，`vector_init` 用错维度也能一眼发现。
   * 后缀取指纹，所以同一个模型参数重复调用是幂等的。
   */
  ensureTable(dimension: number, fingerprint: string): VectorTableRef {
    const { tableName, sourceIndexName } = buildVectorTableNames(dimension, fingerprint);
    getRawDatabase().exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id          INTEGER PRIMARY KEY,
        chunk_id    TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        source_type TEXT NOT NULL,
        ${VECTOR_COLUMN} BLOB NOT NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE(chunk_id)
      );
      CREATE INDEX IF NOT EXISTS ${sourceIndexName} ON ${tableName}(source_type, source_id);
    `);
    return { tableName, dimension };
  }

  /**
   * 批量写入向量。**必须在事务里调用**——本方法只写向量，调用方还要在同一事务里
   * 清掉对应的失败记录，否则会留下「向量已存在但仍有失败记录」的残留。
   *
   * 用 `ON CONFLICT ... DO UPDATE` 而不是 `INSERT OR REPLACE`：后者会删除再插入、
   * 换掉 rowid，而 sqlite-vector 的扫描结果要靠 rowid 关联回本表。
   */
  insertBatch(ref: VectorTableRef, rows: InsertVectorRow[]): void {
    if (rows.length === 0) return;

    const expectedBytes = ref.dimension * BYTES_PER_ELEMENT;
    for (const row of rows) {
      if (row.vector.length !== expectedBytes) {
        throw new Error(
          `向量字节数不符：期望 ${expectedBytes}（${ref.dimension} 维 Float32），实际 ${row.vector.length}`
        );
      }
    }

    const statement = getRawDatabase().prepare(`
      INSERT INTO ${ref.tableName} (chunk_id, source_id, source_type, ${VECTOR_COLUMN}, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        source_id   = excluded.source_id,
        source_type = excluded.source_type,
        ${VECTOR_COLUMN} = excluded.${VECTOR_COLUMN},
        created_at  = excluded.created_at
    `);

    const now = Date.now();
    for (const row of rows) {
      statement.run(row.chunkId, row.sourceId, row.sourceType, row.vector, now);
    }
  }

  /** 某个资源在本模型下已完成的向量数量。 */
  countBySource(tableName: string, sourceId: string): number {
    const row = getRawDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`)
      .get(sourceId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** 一次拿到全部资源的向量数量，避免按书逐个查询。 */
  aggregateBySource(tableName: string): VectorCountBySource[] {
    return getRawDatabase()
      .prepare(
        `SELECT source_id AS sourceId, COUNT(*) AS count FROM ${tableName} GROUP BY source_id`
      )
      .all() as VectorCountBySource[];
  }

  /**
   * 在某个资源的向量里检索最接近查询向量的若干条。
   *
   * **扫描范围必须覆盖整张表**：`vector_full_scan` 的 top-k 是在全表范围内选的，且过滤条件
   * 不下推（实测 `WHERE rowid <= ?` 只减少输出行数、耗时不变）。传 `topK` 会让目标资源的片段
   * 被别的资源挤掉，表现为静默漏召回；好在全表扫描的耗时与 k 无关，取全表行数是免费的。
   *
   * 查询向量收浮点数组：字节布局（Float32 小端）是本表的事，调用方不必知道。
   * 返回的只有文档标识与距离，正文由调用方按标识回查。
   */
  searchBySource(
    ref: VectorTableRef,
    sourceId: string,
    queryValues: readonly number[],
    topK: number
  ): VectorSearchHit[] {
    assertVectorExtensionReady();
    ensureVectorIndex(ref);

    const queryVector = encodeVector(queryValues, ref.dimension);

    // k 必须绑成 BigInt：better-sqlite3 把**所有** JS number 绑成 REAL（实测 typeof(?) = 'real'），
    // 而 vector_full_scan 的第 4 个参数硬性要求 INTEGER，传 REAL 会报
    // "argument 4 must be of type INTEGER (got REAL)"。只有 BigInt 会被绑成 INTEGER。
    const scanLimit = BigInt(countAllRows(ref.tableName));

    return getRawDatabase()
      .prepare(
        `SELECT v.chunk_id AS documentId, s.distance AS distance
           FROM vector_full_scan(?, '${VECTOR_COLUMN}', ?, ?) AS s
           JOIN ${ref.tableName} v ON v.id = s.rowid
          WHERE v.source_id = ?
          ORDER BY s.distance
          LIMIT ?`
      )
      .all(ref.tableName, queryVector, scanLimit, sourceId, topK) as VectorSearchHit[];
  }

  /**
   * 取一批待处理的分片：还没有向量的那些。
   *
   * 「还没有向量」同时覆盖了「从没做过」和「做失败过」两种情况，这正是我们要的——
   * 失败的分片没有向量行，下次继续时自然会被重新取出。判据幂等，所以不需要游标，
   * 重复触发也不会重复花钱。按阅读顺序取，进度看起来才自然。
   *
   * 这里 join 的是 `book_chunk`：目前只有书籍一种资源，闪卡接入时需要另一份实现。
   */
  listPendingBookChunks(tableName: string, bookId: string, limit: number): PendingChunk[] {
    return getRawDatabase()
      .prepare(
        `SELECT c.id AS chunkId, c.content AS content
           FROM book_chunk c
          WHERE c.book_id = ?
            AND NOT EXISTS (SELECT 1 FROM ${tableName} v WHERE v.chunk_id = c.id)
          ORDER BY c.segment_index, c.chunk_index
          LIMIT ?`
      )
      .all(bookId, limit) as PendingChunk[];
  }

  /** 删除某个资源在本模型下的全部向量。用于删除书籍与重新分片。 */
  deleteBySource(tableName: string, sourceType: EmbedSourceType, sourceId: string): void {
    getRawDatabase()
      .prepare(`DELETE FROM ${tableName} WHERE source_type = ? AND source_id = ?`)
      .run(sourceType, sourceId);
  }
}

export const embedVectorRepo = new EmbedVectorRepo();
