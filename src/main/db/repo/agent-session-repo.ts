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

  /** 刷新会话活跃时间，追加 entry 后调用 */
  touch(id: string) {
    const db = getDatabase();
    return db
      .update(agentSessionTable)
      .set({ updatedAt: Date.now() })
      .where(eq(agentSessionTable.id, id))
      .run();
  }

  /** 删除会话，其 entry 由外键级联删除 */
  delete(id: string) {
    const db = getDatabase();
    return db.delete(agentSessionTable).where(eq(agentSessionTable.id, id)).run();
  }

  /** 删除全部会话及其 entry */
  deleteAll() {
    const db = getDatabase();
    return db.delete(agentSessionTable).run();
  }
}

export const agentSessionRepo = new AgentSessionRepo();
