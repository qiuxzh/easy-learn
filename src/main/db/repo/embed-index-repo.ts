import { desc, eq } from 'drizzle-orm';
import { getDatabase } from '..';
import { embedIndexTable } from '../schema';
import type { EmbedIndexRow, InsertEmbedIndexRow } from '../schema';

/**
 * 向量索引注册表的数据访问。
 *
 * 只有一个查找键：指纹。因此不存在「改绑定」这个动作——配置里换了地址或模型，
 * 指纹就变了，会自然走成一条新记录、一张新表，旧记录不动。
 */
export class EmbedIndexRepo {
  /** 按指纹查询。指纹是模型身份，也是唯一的查找入口。 */
  findByFingerprint(fingerprint: string): EmbedIndexRow | undefined {
    return getDatabase()
      .select()
      .from(embedIndexTable)
      .where(eq(embedIndexTable.fingerprint, fingerprint))
      .get();
  }

  /** 按主键查询。 */
  findById(id: number): EmbedIndexRow | undefined {
    return getDatabase().select().from(embedIndexTable).where(eq(embedIndexTable.id, id)).get();
  }

  /** 列出全部已建索引，最近使用的在前。界面用它区分「在用的」与「未被配置引用的」。 */
  listAll(): EmbedIndexRow[] {
    return getDatabase()
      .select()
      .from(embedIndexTable)
      .orderBy(desc(embedIndexTable.lastUsedAt))
      .all();
  }

  /**
   * 按模型标识列出。
   * 不用于查找身份（那用指纹），只用于删除时把同一模型的历史索引一并收集出来。
   */
  listByModelId(modelId: string): EmbedIndexRow[] {
    return getDatabase()
      .select()
      .from(embedIndexTable)
      .where(eq(embedIndexTable.modelId, modelId))
      .all();
  }

  /** 新建一条索引记录。必须在向量表创建所在的同一事务里调用。 */
  create(data: InsertEmbedIndexRow): EmbedIndexRow {
    const rows = getDatabase().insert(embedIndexTable).values(data).returning().all();
    return rows[0];
  }

  /**
   * 记录一次使用：刷新最近使用时间，并可顺带更新展示用的配置名。
   * label 省略时保留已有值——配置改名不该把它清空。
   */
  touch(id: number, usedAt: number, label?: string): void {
    const patch: { lastUsedAt: number; lastLabel?: string } = { lastUsedAt: usedAt };
    if (label !== undefined) {
      patch.lastLabel = label;
    }
    getDatabase().update(embedIndexTable).set(patch).where(eq(embedIndexTable.id, id)).run();
  }
}

export const embedIndexRepo = new EmbedIndexRepo();
