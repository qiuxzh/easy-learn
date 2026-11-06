import { asc, eq } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import { cardGroupTable } from '@main/infra/db/schema';
import type { CardGroupRepo } from '@main/contracts/card-repo';

/**
 * 创建牌组仓储。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createCardGroupRepo(handle: DbHandle): CardGroupRepo {
  return {
    findGroups: () =>
      handle.db.select().from(cardGroupTable).orderBy(asc(cardGroupTable.createdAt)).all(),

    findGroupById: id =>
      handle.db.select().from(cardGroupTable).where(eq(cardGroupTable.id, id)).get(),

    createGroup: input =>
      handle.db
        .insert(cardGroupTable)
        .values({ name: input.name, createdAt: input.now, updatedAt: input.now })
        .returning()
        .get(),

    renameGroup: input =>
      handle.db
        .update(cardGroupTable)
        .set({ name: input.name, updatedAt: input.now })
        .where(eq(cardGroupTable.id, input.id))
        .returning()
        .get(),

    deleteGroup: id => {
      handle.db.delete(cardGroupTable).where(eq(cardGroupTable.id, id)).run();
    },
  };
}
