import { asc, eq, inArray } from 'drizzle-orm';
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
