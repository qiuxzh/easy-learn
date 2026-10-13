import { desc, eq } from 'drizzle-orm';
import { getDatabase } from '..';
import { agentSessionTable } from '../schema';
import type { AgentSessionRow, InsertAgentSessionRow } from '../schema';

export class AgentSessionRepo {
  /** 创建会话。id 由调用方生成，必须显式传入 */
  create(data: InsertAgentSessionRow): AgentSessionRow {
    const db = getDatabase();
    const rows = db.insert(agentSessionTable).values(data).returning().all();
    return rows[0];
  }

  /** 根据 ID 查询会话 */
  findById(id: string) {
    const db = getDatabase();
    return db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id)).get();
  }

  /** 查询全部会话，按最近活跃倒序 */
  findAll() {
    const db = getDatabase();
    return db.select().from(agentSessionTable).orderBy(desc(agentSessionTable.updatedAt)).all();
  }

  /** 修改会话标题 */
  updateTitle(id: string, title: string) {
    const db = getDatabase();
    return db.update(agentSessionTable).set({ title }).where(eq(agentSessionTable.id, id)).run();
  }

  /** 取会话当前所在分支的末端 entry；空会话返回 null。会话就是一个「分支引用」，这句就是读那个引用 */
  findTip(id: string): string | null {
    const db = getDatabase();
    const row = db
      .select({ tipEntryId: agentSessionTable.tipEntryId })
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, id))
      .get();
    return row?.tipEntryId ?? null;
  }

  /** 把会话的引用移到新的分支末端，同时刷新活跃时间 */
  setTip(id: string, tipEntryId: string) {
    const db = getDatabase();
    return db
      .update(agentSessionTable)
      .set({ tipEntryId, updatedAt: Date.now() })
      .where(eq(agentSessionTable.id, id))
      .run();
  }

  /** 是否还有会话把这个 entry 当作分支末端 */
  existsByTip(tipEntryId: string): boolean {
    const db = getDatabase();
    return (
      db
        .select({ id: agentSessionTable.id })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.tipEntryId, tipEntryId))
        .limit(1)
        .get() !== undefined
    );
  }

  /** 删除会话。它引用的 entry 不再随之级联删除，由调用方做可达性回收 */
  delete(id: string) {
    const db = getDatabase();
    return db.delete(agentSessionTable).where(eq(agentSessionTable.id, id)).run();
  }

  /** 删除全部会话（entry 不随之删除） */
  deleteAll() {
    const db = getDatabase();
    return db.delete(agentSessionTable).run();
  }
}

export const agentSessionRepo = new AgentSessionRepo();
