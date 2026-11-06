import { and, asc, count, desc, eq, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import { cardTable } from '@main/infra/db/schema';
import type { CardRow } from '@main/infra/db/schema';
import type {
  CardFields,
  CardEntity,
  CardSchedule,
  CardSortRule,
  CardState,
  CardType,
} from '@main/contracts/card';
import type { CardRepo } from '@main/contracts/card-repo';

/** 排序字段到数据库列的映射。 */
const CARD_SORT_COLUMNS = {
  createdAt: cardTable.createdAt,
  updatedAt: cardTable.updatedAt,
  due: cardTable.due,
  difficulty: cardTable.difficulty,
  reps: cardTable.reps,
} as const;

/** 卡片行转换为领域记录：JSON 列在这里解析，调用方只看到对象与数组。 */
function toCardEntity(row: CardRow): CardEntity {
  return {
    ...row,
    type: row.type as CardType,
    fields: parseJson<CardFields>(row.fields, { front: '', back: '' }),
    tags: parseJson<string[]>(row.tags, []),
    state: row.state as CardState,
  };
}

/** 安全解析 JSON 列，旧数据异常时回退到默认值。 */
function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 把排序规则转换成 Drizzle 的 orderBy 参数，省略时按最后修改时间降序。 */
function toOrderBy(sort?: CardSortRule[]) {
  const rules = sort && sort.length > 0 ? sort : [{ field: 'updatedAt', order: 'desc' } as const];
  return rules.map(rule =>
    rule.order === 'desc' ? desc(CARD_SORT_COLUMNS[rule.field]) : asc(CARD_SORT_COLUMNS[rule.field])
  );
}

/**
 * 转义 LIKE 模式中的通配符。
 * 标签里的 % 和 _ 是普通字符，但在 LIKE 中是通配符，不转义会造成误命中。
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => '\\' + character);
}

/**
 * 创建卡片仓储。
 *
 * @param handle 已打开的数据库连接，由装配根传入
 */
export function createCardRepo(handle: DbHandle): CardRepo {
  /** 复习队列的到期判定与排序都在 SQL 层完成，避免把整表读进内存再过滤。 */
  const queryDueQueue = (due: SQL | undefined): CardEntity[] =>
    handle.db
      .select()
      .from(cardTable)
      .where(due)
      .orderBy(sql`CASE WHEN ${cardTable.state} = 0 THEN 1 ELSE 0 END`, asc(cardTable.due))
      .all()
      .map(toCardEntity);

  return {
    findAllCards: () =>
      handle.db.select().from(cardTable).orderBy(asc(cardTable.createdAt)).all().map(toCardEntity),

    findCardById: id => {
      const row = handle.db.select().from(cardTable).where(eq(cardTable.id, id)).get();
      return row ? toCardEntity(row) : undefined;
    },

    findCardsByGroupId: groupId =>
      handle.db
        .select()
        .from(cardTable)
        .where(eq(cardTable.groupId, groupId))
        .orderBy(asc(cardTable.createdAt))
        .all()
        .map(toCardEntity),

    queryCards: input => {
      const conditions = [];
      if (input.groupId !== undefined) {
        conditions.push(eq(cardTable.groupId, input.groupId));
      }
      if (input.state !== undefined) {
        conditions.push(eq(cardTable.state, input.state));
      }
      if (input.dueBefore !== undefined) {
        conditions.push(lte(cardTable.due, input.dueBefore));
      }
      for (const tag of input.tags ?? []) {
        // tags 是 JSON 文本数组，用引号锚定标签边界，避免 "js" 命中 "xjs"。
        // 必须显式声明 ESCAPE 子句：否则反斜杠不具备转义含义，标签含 _ 或 % 时会匹配不到。
        conditions.push(
          sql`${cardTable.tags} LIKE ${'%"' + escapeLikePattern(tag) + '"%'} ESCAPE '\\'`
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const total =
        handle.db.select({ value: count() }).from(cardTable).where(where).get()?.value ?? 0;

      let query = handle.db
        .select()
        .from(cardTable)
        .where(where)
        .orderBy(...toOrderBy(input.sort))
        .$dynamic();
      if (input.length !== undefined) {
        query = query.limit(input.length);
      }
      if (input.offset !== undefined) {
        query = query.offset(input.offset);
      }

      return { cards: query.all().map(toCardEntity), total };
    },

    listTags: () => {
      const rows = handle.db.select({ tags: cardTable.tags }).from(cardTable).all();
      return [...new Set(rows.flatMap(row => parseJson<string[]>(row.tags, [])))];
    },

    createCard: input => {
      const row = handle.db
        .insert(cardTable)
        .values({
          id: input.id,
          groupId: input.groupId,
          type: input.type,
          fields: JSON.stringify(input.fields),
          tags: JSON.stringify(input.tags),
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          due: input.due,
          stability: input.stability,
          difficulty: input.difficulty,
          elapsedDays: input.elapsedDays,
          scheduledDays: input.scheduledDays,
          learningSteps: input.learningSteps,
          reps: input.reps,
          lapses: input.lapses,
          state: input.state,
          lastReview: input.lastReview,
        })
        .returning()
        .get();
      return toCardEntity(row);
    },

    updateCardContent: input => {
      if (!input.id) return undefined;
      const row = handle.db
        .update(cardTable)
        .set({
          groupId: input.groupId,
          type: input.type,
          fields: JSON.stringify(input.fields),
          tags: JSON.stringify(input.tags),
          updatedAt: input.updatedAt,
        })
        .where(eq(cardTable.id, input.id))
        .returning()
        .get();
      return row ? toCardEntity(row) : undefined;
    },

    updateCardSchedule: (id, schedule: CardSchedule, now: number) => {
      const row = handle.db
        .update(cardTable)
        .set({
          due: schedule.due,
          stability: schedule.stability,
          difficulty: schedule.difficulty,
          elapsedDays: schedule.elapsedDays,
          scheduledDays: schedule.scheduledDays,
          learningSteps: schedule.learningSteps,
          reps: schedule.reps,
          lapses: schedule.lapses,
          state: schedule.state,
          lastReview: schedule.lastReview,
          updatedAt: now,
        })
        .where(eq(cardTable.id, id))
        .returning()
        .get();
      return row ? toCardEntity(row) : undefined;
    },

    deleteCard: id => {
      handle.db.delete(cardTable).where(eq(cardTable.id, id)).run();
    },

    findReviewQueue: input =>
      queryDueQueue(
        and(
          eq(cardTable.groupId, input.groupId),
          or(eq(cardTable.state, 0), lte(cardTable.due, input.now))
        )
      ),

    findAllReviewQueue: now => queryDueQueue(or(eq(cardTable.state, 0), lte(cardTable.due, now))),
  };
}
