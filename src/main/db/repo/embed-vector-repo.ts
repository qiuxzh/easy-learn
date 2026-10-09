import { getRawDatabase } from '..';
import { buildVectorTableNames } from '../embedding-identity';

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

/** 一行向量的字节数（Float32）。 */
const BYTES_PER_ELEMENT = 4;

/**
 * 向量表的数据访问。
 *
 * 向量表是按模型在运行时创建的、表名不固定，drizzle 的静态 schema 表达不了，
 * 所以这里全部走原始 SQL。表名与索引名都由 `buildVectorTableNames` 从维度与指纹拼出，
 * 从构造上排除注入。
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
        source_type TEXT NOT NULL DEFAULT 'book',
        vector      BLOB NOT NULL,
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
      INSERT INTO ${ref.tableName} (chunk_id, source_id, source_type, vector, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        source_id   = excluded.source_id,
        source_type = excluded.source_type,
        vector      = excluded.vector,
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

  /** 按资源聚合「还剩多少分片没做」，供书库列表与详情页计算进度。 */
  aggregatePendingByBook(tableName: string): VectorCountBySource[] {
    return getRawDatabase()
      .prepare(
        `SELECT c.book_id AS sourceId, COUNT(*) AS count
           FROM book_chunk c
          WHERE NOT EXISTS (SELECT 1 FROM ${tableName} v WHERE v.chunk_id = c.id)
          GROUP BY c.book_id`
      )
      .all() as VectorCountBySource[];
  }

  /** 删除某个资源在本模型下的全部向量。用于删除书籍与重新分片。 */
  deleteBySource(tableName: string, sourceType: EmbedSourceType, sourceId: string): void {
    getRawDatabase()
      .prepare(`DELETE FROM ${tableName} WHERE source_type = ? AND source_id = ?`)
      .run(sourceType, sourceId);
  }
}

export const embedVectorRepo = new EmbedVectorRepo();
