import { eq, inArray } from 'drizzle-orm';
import { getDatabase } from '..';
import { agentEntryTable } from '../schema';
import type { AgentEntryRow, InsertAgentEntryRow } from '../schema';

/**
 * 消息对象仓储。entry 不属于任何会话
 */
export class AgentEntryRepo {
  /** 追加一条 entry */
  append(data: InsertAgentEntryRow): AgentEntryRow {
    const db = getDatabase();
    const rows = db.insert(agentEntryTable).values(data).returning().all();
    return rows[0];
  }

  /** 按主键取一条 entry */
  findById(id: string): AgentEntryRow | undefined {
    const db = getDatabase();
    return db.select().from(agentEntryTable).where(eq(agentEntryTable.id, id)).get();
  }

  /** 某个 entry 的全部直接子节点 id：分叉点判断与可达性回收都要用 */
  listChildIds(parentEntryId: string): string[] {
    const db = getDatabase();
    return db
      .select({ id: agentEntryTable.id })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.parentEntryId, parentEntryId))
      .all()
      .map(row => row.id);
  }

  /** 删除若干 entry，用于可达性回收 */
  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;
    const db = getDatabase();
    db.delete(agentEntryTable).where(inArray(agentEntryTable.id, ids)).run();
  }
}

export const agentEntryRepo = new AgentEntryRepo();
