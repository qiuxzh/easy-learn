import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs';
import { DomainError } from '@main/domain-error';
import type {
  CardFields,
  CardGroupEntity,
  CardGroupCounts,
  CardGroupSummary,
  CardPage,
  CardQuery,
  CardRating,
  CardEntity,
  CardSchedule,
  CardState,
  CardType,
  CardWrite,
} from '@main/contracts/card';
import type { CardRepo } from '@main/contracts/card-repo';
import type { CardGroupRepo } from '@main/contracts/card-repo';

/** FSRS 评分名称到 ts-fsrs 枚举的映射。 */
const RATING_MAP = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

/** 创建 FlashcardService 所需的依赖。 */
export interface FlashcardServiceDeps {
  /** 卡片持久化。 */
  cardRepo: CardRepo;
  /** 牌组持久化。 */
  cardGroupRepo: CardGroupRepo;
  /** 取当前时刻的 Unix 毫秒时间戳；注入固定值可让 FSRS 结果可复现。默认 Date.now。 */
  now?: () => number;
}

/**
 * 闪卡业务服务：牌组、卡片与复习进度的规则都收敛在这里。
 *
 * 方法失败抛 `DomainError`（文案面向用户），由 IPC 层转换成 `{ success: false, error }`；
 * 服务本身不感知传输方式，也不依赖 electron 或数据库实现。
 */
export class FlashcardService {
  private readonly cardRepo: CardRepo;
  private readonly cardGroupRepo: CardGroupRepo;
  private readonly now: () => number;
  private readonly scheduler = fsrs();

  constructor(deps: FlashcardServiceDeps) {
    this.cardRepo = deps.cardRepo;
    this.cardGroupRepo = deps.cardGroupRepo;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * 列出全部牌组，并统计各自的复习进度。
   *
   * @returns 每个牌组附带新卡、到期学习卡、到期复习卡与总数
   */
  listGroups(): CardGroupSummary[] {
    const now = this.now();
    const cards = this.cardRepo.findAllCards();
    return this.cardGroupRepo.findGroups().map(group =>
      summarizeGroup(
        group,
        cards.filter(card => card.groupId === group.id),
        now
      )
    );
  }

  /**
   * 按 id 取牌组。
   *
   * @returns 牌组不存在时返回 undefined
   */
  getGroup(id: string): CardGroupEntity | undefined {
    return this.cardGroupRepo.findGroupById(id);
  }

  /**
   * 新增牌组。
   *
   * @throws DomainError 名称去首尾空白后为空
   */
  createGroup(input: { name: string }): CardGroupSummary {
    const now = this.now();
    const name = normalizeGroupName(input.name);
    return summarizeGroup(this.cardGroupRepo.createGroup({ name, now }), [], now);
  }

  /**
   * 修改牌组名称，返回带最新统计的牌组。
   *
   * @throws DomainError 名称为空或牌组不存在
   */
  renameGroup(input: { id: string; name: string }): CardGroupSummary {
    const name = normalizeGroupName(input.name);
    const now = this.now();
    const group = this.cardGroupRepo.renameGroup({ id: input.id, name, now });
    if (!group) throw new DomainError('牌组不存在');
    return summarizeGroup(group, this.cardRepo.findCardsByGroupId(group.id), now);
  }

  /**
   * 删除牌组及其卡片。
   *
   * @throws DomainError 牌组不存在
   */
  deleteGroup(input: { id: string }): void {
    if (!this.cardGroupRepo.findGroupById(input.id)) throw new DomainError('牌组不存在');
    this.cardGroupRepo.deleteGroup(input.id);
  }

  /**
   * 按牌组与标签查询卡片，同时返回全部卡片出现过的标签供筛选。
   *
   * @param input 两个条件都可省略，省略即不过滤
   */
  listCards(input: { groupId?: string; tag?: string }): { cards: CardEntity[]; tags: string[] } {
    const page = this.cardRepo.queryCards({
      groupId: input.groupId,
      tags: input.tag ? [input.tag] : undefined,
    });
    return { cards: page.cards, tags: collectTags(this.cardRepo.listTags()) };
  }

  /**
   * 按条件分页查询卡片，供智能体的列表工具使用。
   *
   * @param input 过滤、排序与分页条件
   * @returns 当前页与满足条件的总数
   */
  queryCards(input: CardQuery): CardPage {
    return this.cardRepo.queryCards(input);
  }

  /**
   * 按 id 取卡片。
   *
   * @throws DomainError 卡片不存在
   */
  getCard(input: { id: string }): CardEntity {
    const card = this.cardRepo.findCardById(input.id);
    if (!card) throw new DomainError('卡片不存在');
    return card;
  }

  /**
   * 新增或覆盖保存卡片内容，复习进度保持不变；新建卡片按 FSRS 初始化复习进度。
   *
   * @throws DomainError 牌组不存在、卡片不存在（带 id 但查不到）、正反面为空
   */
  saveCard(input: {
    id?: string;
    groupId: string;
    type?: CardType;
    fields: CardFields;
    tags: string[];
  }): CardEntity {
    if (!this.cardGroupRepo.findGroupById(input.groupId)) throw new DomainError('牌组不存在');
    validateFields(input.fields);

    const existing = input.id ? this.cardRepo.findCardById(input.id) : undefined;
    if (input.id && !existing) throw new DomainError('卡片不存在');

    const now = this.now();
    const data: CardWrite = {
      id: input.id,
      groupId: input.groupId,
      type: input.type ?? existing?.type ?? 'basic',
      fields: input.fields,
      tags: normalizeTags(input.tags),
      // 新建时显式落库创建时间，不让 schema 的默认值决定，注入的 now 才能复现
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing ? toSchedule(existing) : createInitialSchedule(now)),
    };

    const saved = existing ? this.cardRepo.updateCardContent(data) : this.cardRepo.createCard(data);
    if (!saved) throw new DomainError('卡片不存在');
    return saved;
  }

  /**
   * 删除单张卡片。
   *
   * @throws DomainError 卡片不存在
   */
  deleteCard(input: { id: string }): void {
    if (!this.cardRepo.findCardById(input.id)) throw new DomainError('卡片不存在');
    this.cardRepo.deleteCard(input.id);
  }

  /**
   * 获取复习队列：到期卡片优先、新卡随后；省略 groupId 时混排全部牌组。
   *
   * @throws DomainError 指定了 groupId 但牌组不存在
   */
  getReviewQueue(input: { groupId?: string }): CardEntity[] {
    const now = this.now();
    if (!input.groupId) return this.cardRepo.findAllReviewQueue(now);
    if (!this.cardGroupRepo.findGroupById(input.groupId)) throw new DomainError('牌组不存在');
    return this.cardRepo.findReviewQueue({ groupId: input.groupId, now });
  }

  /**
   * 记录一次复习评分，并按 FSRS 回写新的复习进度。
   *
   * @throws DomainError 卡片不存在
   */
  reviewCard(input: { id: string; rating: CardRating }): CardEntity {
    const current = this.cardRepo.findCardById(input.id);
    if (!current) throw new DomainError('卡片不存在');

    const now = this.now();
    const next = this.scheduler.next(toFsrsCard(current), new Date(now), RATING_MAP[input.rating]);
    const updated = this.cardRepo.updateCardSchedule(
      input.id,
      {
        due: next.card.due.getTime(),
        stability: next.card.stability,
        difficulty: next.card.difficulty,
        elapsedDays: next.card.elapsed_days,
        scheduledDays: next.card.scheduled_days,
        learningSteps: next.card.learning_steps,
        reps: next.card.reps,
        lapses: next.card.lapses,
        state: next.card.state as CardState,
        lastReview: next.card.last_review?.getTime() ?? null,
      },
      now
    );
    if (!updated) throw new DomainError('卡片不存在');
    return updated;
  }
}

/**
 * 统计一组卡片的复习进度。
 *
 * @param cards 同一牌组下的卡片
 * @param now 判定「到期」的时刻，Unix 毫秒时间戳
 */
function countCards(cards: CardEntity[], now: number): CardGroupCounts {
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

/**
 * 把牌组与其卡片合成为带统计的摘要。
 *
 * @param group 牌组本身
 * @param cards 该牌组下的全部卡片
 * @param now 判定「到期」的时刻，Unix 毫秒时间戳
 */
function summarizeGroup(
  group: CardGroupEntity,
  cards: CardEntity[],
  now: number
): CardGroupSummary {
  return { ...group, ...countCards(cards, now) };
}

/**
 * 标签去重并按字典序排列。
 *
 * @param tags 全部卡片出现过的标签
 */
function collectTags(tags: string[]): string[] {
  return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
}

/** 取出卡片记录里的 FSRS 状态，用于内容更新时原样保留。 */
function toSchedule(card: CardEntity): CardSchedule {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
  };
}

/** 新卡片的初始复习进度：全是新卡，到期时间取创建时刻。 */
function createInitialSchedule(now: number): CardSchedule {
  const card = createEmptyCard(new Date(now));
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardState,
    lastReview: card.last_review?.getTime() ?? null,
  };
}

/** 将持久化卡片转换为 ts-fsrs 输入对象。 */
function toFsrsCard(card: CardEntity) {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    last_review: card.lastReview === null ? undefined : new Date(card.lastReview),
  };
}

/** 牌组名称去首尾空白；为空时拒绝写入。 */
function normalizeGroupName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new DomainError('牌组名称不能为空');
  return normalized;
}

/** 对标签去空格、去重，并过滤空标签。 */
function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

/** 校验卡片的正反面内容。 */
function validateFields(fields: CardFields): void {
  if (!fields.front.trim()) throw new DomainError('卡片正面不能为空');
  if (!fields.back.trim()) throw new DomainError('卡片反面不能为空');
}
