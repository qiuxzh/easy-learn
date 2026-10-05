import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDatabase } from '..';
import { cardGroupTable, cardTable } from '../schema';
import type { CardGroupRow, CardRow } from '../schema';
import type { CardFields, CardState, CardType } from '@shared/types/flashcards';

/** 牌组队列统计结果，供管理页展示。 */
export interface CardGroupCounts {
  /** 未学习的新卡数量。 */
  unlearned: number;
  /** 当前到期的学习中卡片数量。 */
  learning: number;
  /** 当前到期的复习卡数量。 */
  due: number;
  /** 卡片总数。 */
  total: number;
}

/** 写入卡片时使用的领域数据。 */
export interface CardWriteData {
  id?: string;
  groupId: string;
  type: CardType;
  fields: CardFields;
  tags: string[];
  createdAt?: number;
  updatedAt: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: number | null;
}

/** 卡片列表可排序的字段，均为 cards 表上的普通列。 */
export type CardSortField = 'createdAt' | 'updatedAt' | 'due' | 'difficulty' | 'reps';

/** 单个排序规则。 */
export interface CardSortRule {
  /** 排序字段。 */
  field: CardSortField;
  /** 排序方向。 */
  order: 'asc' | 'desc';
}

/** 卡片列表查询条件。各条件之间是「且」的关系，省略则不参与过滤。 */
export interface CardQueryOptions {
  /** 所属牌组 id。 */
  groupId?: string;
  /** 标签，需同时命中全部标签。 */
  tags?: string[];
  /** FSRS 卡片状态。 */
  state?: CardState;
  /** 只返回该时间戳之前到期的卡片。 */
  dueBefore?: number;
  /** 多级排序规则，省略时按最后修改时间降序。 */
  sort?: CardSortRule[];
  /** 跳过的卡片数量。 */
  offset?: number;
  /** 返回的卡片数量上限。 */
  length?: number;
}

/** 卡片列表查询结果。 */
export interface CardQueryResult {
  /** 当前页的卡片行。 */
  cards: CardRow[];
  /** 满足条件的卡片总数，不受分页影响。 */
  total: number;
}

/** 将数据库卡片行转换为渲染层使用的领域记录。 */
export function toCardRecord(row: CardRow) {
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

/** 将牌组行附加统计信息。 */
export function toCardGroupSummary(row: CardGroupRow, cards: ReturnType<typeof toCardRecord>[]) {
  const counts = countCards(cards);
  return { ...row, ...counts };
}

/** 统计牌组当前可学习和待复习的卡片数量。 */
export function countCards(
  cards: ReturnType<typeof toCardRecord>[],
  now = Date.now()
): CardGroupCounts {
  return cards.reduce<CardGroupCounts>(
    (counts, card) => {
      counts.total += 1;
      if (card.state === 0) counts.unlearned += 1;
      if ((card.state === 1 || card.state === 3) && card.due <= now) counts.learning += 1;
      if (card.state === 2 && card.due <= now) counts.due += 1;
      return counts;
    },
    { unlearned: 0, learning: 0, due: 0, total: 0 }
  );
}

/** 闪卡牌组与卡片的数据仓储。 */
export class FlashcardRepo {
  /** 查询全部牌组，按创建时间升序。 */
  findGroups(): CardGroupRow[] {
    return getDatabase().select().from(cardGroupTable).orderBy(asc(cardGroupTable.createdAt)).all();
  }

  /** 根据 ID 查询牌组。 */
  findGroupById(id: string): CardGroupRow | undefined {
    return getDatabase().select().from(cardGroupTable).where(eq(cardGroupTable.id, id)).get();
  }

  /** 新增牌组。 */
  createGroup(name: string): CardGroupRow {
    const now = Date.now();
    return getDatabase()
      .insert(cardGroupTable)
      .values({ name, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }

  /** 修改牌组名称。 */
  renameGroup(id: string, name: string): CardGroupRow | undefined {
    return getDatabase()
      .update(cardGroupTable)
      .set({ name, updatedAt: Date.now() })
      .where(eq(cardGroupTable.id, id))
      .returning()
      .get();
  }

  /** 删除牌组，并依赖数据库外键级联删除卡片。 */
  deleteGroup(id: string): void {
    getDatabase().delete(cardGroupTable).where(eq(cardGroupTable.id, id)).run();
  }

  /** 查询全部卡片。 */
  findAllCards(): CardRow[] {
    return getDatabase().select().from(cardTable).orderBy(asc(cardTable.createdAt)).all();
  }

  /** 查询指定卡片。 */
  findCardById(id: string): CardRow | undefined {
    return getDatabase().select().from(cardTable).where(eq(cardTable.id, id)).get();
  }

  /**
   * 按条件分页查询卡片，并返回满足条件的总数。
   * 过滤、排序与分页都在 SQL 层完成，total 单独统计，因此不受分页影响。
   */
  queryCards(options: CardQueryOptions = {}): CardQueryResult {
    const conditions = [];
    if (options.groupId !== undefined) {
      conditions.push(eq(cardTable.groupId, options.groupId));
    }
    if (options.state !== undefined) {
      conditions.push(eq(cardTable.state, options.state));
    }
    if (options.dueBefore !== undefined) {
      conditions.push(lte(cardTable.due, options.dueBefore));
    }
    for (const tag of options.tags ?? []) {
      // tags 是 JSON 文本数组，用引号锚定标签边界，避免 "js" 命中 "xjs"。
      // 必须显式声明 ESCAPE 子句：否则反斜杠不具备转义含义，标签含 _ 或 % 时会匹配不到。
      conditions.push(
        sql`${cardTable.tags} LIKE ${'%"' + escapeLikePattern(tag) + '"%'} ESCAPE '\\'`
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const total =
      getDatabase().select({ value: count() }).from(cardTable).where(where).get()?.value ?? 0;

    const orderBy = toOrderBy(options.sort);
    let query = getDatabase()
      .select()
      .from(cardTable)
      .where(where)
      .orderBy(...orderBy)
      .$dynamic();
    if (options.length !== undefined) {
      query = query.limit(options.length);
    }
    if (options.offset !== undefined) {
      query = query.offset(options.offset);
    }

    return { cards: query.all(), total };
  }

  /** 查询指定牌组中的卡片。 */
  findCardsByGroupId(groupId: string): CardRow[] {
    return getDatabase()
      .select()
      .from(cardTable)
      .where(eq(cardTable.groupId, groupId))
      .orderBy(asc(cardTable.createdAt))
      .all();
  }

  /** 根据牌组和标签查询卡片。 */
  findCards(groupId?: string, tag?: string): CardRow[] {
    const cards = groupId ? this.findCardsByGroupId(groupId) : this.findAllCards();
    if (!tag) return cards;
    return cards.filter(card => parseJson<string[]>(card.tags, []).includes(tag));
  }

  /** 新增卡片。 */
  createCard(data: CardWriteData): CardRow {
    return getDatabase()
      .insert(cardTable)
      .values({
        id: data.id,
        groupId: data.groupId,
        type: data.type,
        fields: JSON.stringify(data.fields),
        tags: JSON.stringify(data.tags),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        due: data.due,
        stability: data.stability,
        difficulty: data.difficulty,
        elapsedDays: data.elapsedDays,
        scheduledDays: data.scheduledDays,
        learningSteps: data.learningSteps,
        reps: data.reps,
        lapses: data.lapses,
        state: data.state,
        lastReview: data.lastReview,
      })
      .returning()
      .get();
  }

  /** 修改卡片内容并保留复习状态。 */
  updateCardContent(data: CardWriteData): CardRow | undefined {
    if (!data.id) return undefined;
    return getDatabase()
      .update(cardTable)
      .set({
        groupId: data.groupId,
        type: data.type,
        fields: JSON.stringify(data.fields),
        tags: JSON.stringify(data.tags),
        updatedAt: data.updatedAt,
      })
      .where(eq(cardTable.id, data.id))
      .returning()
      .get();
  }

  /** 更新卡片的 FSRS 状态。 */
  updateCardSchedule(
    id: string,
    data: Omit<
      CardWriteData,
      'id' | 'groupId' | 'type' | 'fields' | 'tags' | 'createdAt' | 'updatedAt'
    >
  ): CardRow | undefined {
    return getDatabase()
      .update(cardTable)
      .set({
        due: data.due,
        stability: data.stability,
        difficulty: data.difficulty,
        elapsedDays: data.elapsedDays,
        scheduledDays: data.scheduledDays,
        learningSteps: data.learningSteps,
        reps: data.reps,
        lapses: data.lapses,
        state: data.state,
        lastReview: data.lastReview,
        updatedAt: Date.now(),
      })
      .where(eq(cardTable.id, id))
      .returning()
      .get();
  }

  /** 删除单张卡片。 */
  deleteCard(id: string): void {
    getDatabase().delete(cardTable).where(eq(cardTable.id, id)).run();
  }

  /** 查询复习队列中的卡片：到期卡片优先，新卡片随后。 */
  findReviewQueue(groupId: string, now = Date.now()): CardRow[] {
    const cards = this.findCardsByGroupId(groupId)
      .map(toCardRecord)
      .filter(card => card.state === 0 || card.due <= now)
      .sort((left, right) => {
        const leftNew = left.state === 0 ? 1 : 0;
        const rightNew = right.state === 0 ? 1 : 0;
        if (leftNew !== rightNew) return leftNew - rightNew;
        return left.due - right.due;
      });
    const ids = cards.map(card => card.id);
    if (ids.length === 0) return [];
    return getDatabase()
      .select()
      .from(cardTable)
      .where(inArray(cardTable.id, ids))
      .all()
      .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
  }
}

export const flashcardRepo = new FlashcardRepo();
/** 排序字段到数据库列的映射。 */
const CARD_SORT_COLUMNS = {
  createdAt: cardTable.createdAt,
  updatedAt: cardTable.updatedAt,
  due: cardTable.due,
  difficulty: cardTable.difficulty,
  reps: cardTable.reps,
} as const;

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
