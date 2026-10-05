import { asc, eq, max } from 'drizzle-orm';
import { getDatabase } from '..';
import { agentEntryTable } from '../schema';
import type { AgentEntryRow, InsertAgentEntryRow } from '../schema';

export class AgentEntryRepo {
  /** 追加一条 entry */
  append(data: InsertAgentEntryRow): AgentEntryRow {
    const db = getDatabase();
    const rows = db.insert(agentEntryTable).values(data).returning().all();
    return rows[0];
  }

  /** 按 seq 升序读取某会话的全部 entry */
  findBySessionId(sessionId: string) {
    const db = getDatabase();
    return db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.sessionId, sessionId))
      .orderBy(asc(agentEntryTable.seq))
      .all();
  }

  /** 取某会话下一个可用序号，空会话返回 0 */
  nextSeq(sessionId: string): number {
    const db = getDatabase();
    const row = db
      .select({ maxSeq: max(agentEntryTable.seq) })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.sessionId, sessionId))
      .get();
    return (row?.maxSeq ?? -1) + 1;
  }
}

export const agentEntryRepo = new AgentEntryRepo();
