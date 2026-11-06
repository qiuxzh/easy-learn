import { eq, inArray } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import { agentEntryTable, agentSessionTable } from '@main/infra/db/schema';
import type { AgentEntryRow } from '@main/infra/db/schema';
import type {
  SessionEntryAppend,
  SessionEntryEntity,
  SessionEntryKind,
} from '@main/contracts/session';
import type { SessionEntryRepo } from '@main/contracts/session-repo';

/** entry 行转换为领域记录，type 收窄回领域枚举。 */
function toEntryRecord(row: AgentEntryRow): SessionEntryEntity {
  return { ...row, type: row.type as SessionEntryKind };
}

/**
 * 创建会话日志 entry 的仓储。
 *
 * 追加 entry 要同时移动会话的引用（tip），两者属于同一聚合，因此在实现内部包事务。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createSessionEntryRepo(handle: DbHandle): SessionEntryRepo {
  return {
    findById: id => {
      const row = handle.db.select().from(agentEntryTable).where(eq(agentEntryTable.id, id)).get();
      return row ? toEntryRecord(row) : undefined;
    },

    listChildIds: parentEntryId =>
      handle.db
        .select({ id: agentEntryTable.id })
        .from(agentEntryTable)
        .where(eq(agentEntryTable.parentEntryId, parentEntryId))
        .all()
        .map(row => row.id),

    appendAndMoveTip: (input: SessionEntryAppend) =>
      handle.transaction(() => {
        const row = handle.db
          .insert(agentEntryTable)
          .values({
            id: input.id,
            parentEntryId: input.parentEntryId,
            type: input.type,
            createdAt: input.now,
            payload: input.payload,
          })
          .returning()
          .get();

        const updated = handle.db
          .update(agentSessionTable)
          .set({ tipEntryId: input.id, updatedAt: input.now })
          .where(eq(agentSessionTable.id, input.sessionId))
          .run();

        // 会话行不存在就整体回滚，避免留下一条没有任何分支引用的孤儿 entry
        if (updated.changes !== 1) {
          throw new Error(`会话不存在: ${input.sessionId}`);
        }
        return toEntryRecord(row);
      }),

    deleteByIds: ids => {
      if (ids.length === 0) return;
      handle.db.delete(agentEntryTable).where(inArray(agentEntryTable.id, ids)).run();
    },
  };
}
