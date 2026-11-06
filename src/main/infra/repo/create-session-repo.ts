import { desc, eq, inArray } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import { agentEntryTable, agentSessionTable } from '@main/infra/db/schema';
import type { AgentSessionRow } from '@main/infra/db/schema';
import type { SessionEntity } from '@main/contracts/session';
import type { SessionRepo } from '@main/contracts/session-repo';

/** 会话行转换为领域记录。 */
function toSessionEntity(row: AgentSessionRow): SessionEntity {
  return { ...row };
}

/**
 * 创建会话仓储。
 *
 * 会话是聚合根，回收 entry 也归这里管：`deleteWithEntries` 在一个事务里删会话行与已经
 * 判定为不可达的 entry。追加 entry 在 `createSessionEntryRepo` 里。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createSessionRepo(handle: DbHandle): SessionRepo {
  return {
    create: input =>
      toSessionEntity(
        handle.db
          .insert(agentSessionTable)
          .values({
            id: input.id,
            title: input.title,
            tipEntryId: input.tipEntryId ?? null,
            ephemeral: input.ephemeral ?? false,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
          .get()
      ),

    findById: id => {
      const row = handle.db
        .select()
        .from(agentSessionTable)
        .where(eq(agentSessionTable.id, id))
        .get();
      return row ? toSessionEntity(row) : undefined;
    },

    listPersistent: () =>
      handle.db
        .select()
        .from(agentSessionTable)
        .where(eq(agentSessionTable.ephemeral, false))
        .orderBy(desc(agentSessionTable.updatedAt))
        .all()
        .map(toSessionEntity),

    updateTitle: input => {
      handle.db
        .update(agentSessionTable)
        .set({ title: input.title })
        .where(eq(agentSessionTable.id, input.id))
        .run();
    },

    findTip: id => {
      const row = handle.db
        .select({ tipEntryId: agentSessionTable.tipEntryId })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.id, id))
        .get();
      return row?.tipEntryId ?? null;
    },

    existsByTip: tipEntryId =>
      handle.db
        .select({ id: agentSessionTable.id })
        .from(agentSessionTable)
        .where(eq(agentSessionTable.tipEntryId, tipEntryId))
        .limit(1)
        .get() !== undefined,

    deleteWithEntries: input => {
      handle.transaction(() => {
        handle.db.delete(agentSessionTable).where(eq(agentSessionTable.id, input.id)).run();
        if (input.entryIds.length > 0) {
          handle.db
            .delete(agentEntryTable)
            .where(inArray(agentEntryTable.id, input.entryIds))
            .run();
        }
      });
    },
  };
}
