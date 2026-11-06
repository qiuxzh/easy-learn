/**
 * 闪卡的领域实体与查询条件。
 *
 * 实体由主进程拥有，与渲染层的 IPC 契约（`@shared/types/flashcards`）分开：两者形状一致但各自演化，
 * 由 IPC 层负责映射。本文件只放类型，不得 import 数据库实现或 electron。
 */

/** 闪卡支持的卡片类型。当前只实现 Basic，保留后续扩展入口。 */
export type CardType = 'basic';

/** FSRS 卡片状态。数值与 ts-fsrs 的 State 枚举保持一致。 */
export type CardState = 0 | 1 | 2 | 3;

/** 复习按钮对应的评分。 */
export type CardRating = 'again' | 'hard' | 'good' | 'easy';

/** 卡片正面与反面的 Markdown 内容。 */
export interface CardFields {
  front: string;
  back: string;
}

/** 牌组实体。 */
export interface CardGroupEntity {
  /** 牌组唯一标识。 */
  id: string;
  /** 牌组名称。 */
  name: string;
  /** 创建时间，Unix 毫秒时间戳。 */
  createdAt: number;
  /** 最后修改时间，Unix 毫秒时间戳。 */
  updatedAt: number;
}

/** 牌组的复习进度统计。 */
export interface CardGroupCounts {
  /** 未学习的新卡数量。 */
  unlearned: number;
  /** 到期的学习中卡片数量。 */
  learning: number;
  /** 到期的复习卡数量。 */
  due: number;
  /** 卡片总数。 */
  total: number;
}

/** 牌组及其统计信息。 */
export interface CardGroupSummary extends CardGroupEntity, CardGroupCounts {}

/** 闪卡实体及 FSRS 复习状态。 */
export interface CardEntity {
  /** 卡片唯一标识。 */
  id: string;
  /** 所属牌组 id。 */
  groupId: string;
  /** 卡片类型。 */
  type: CardType;
  /** 正反面内容。 */
  fields: CardFields;
  /** 标签。 */
  tags: string[];
  /** 创建时间，Unix 毫秒时间戳。 */
  createdAt: number;
  /** 最后修改时间，Unix 毫秒时间戳。 */
  updatedAt: number;
  /** 下一次可复习时间，Unix 毫秒时间戳。 */
  due: number;
  /** FSRS 稳定性参数。 */
  stability: number;
  /** FSRS 难度参数。 */
  difficulty: number;
  /** 上次复习距今经过的天数。 */
  elapsedDays: number;
  /** 上次复习排定的间隔天数。 */
  scheduledDays: number;
  /** 当前学习步骤编号。 */
  learningSteps: number;
  /** 累计复习次数。 */
  reps: number;
  /** 遗忘后重新学习的次数。 */
  lapses: number;
  /** FSRS 卡片状态。 */
  state: CardState;
  /** 最近一次复习时间；未复习为 null。 */
  lastReview: number | null;
}

/** 写入卡片所需的完整数据；省略 `id` 表示新建。 */
export interface CardWrite {
  /** 卡片 id；省略时由数据库生成。 */
  id?: string;
  /** 所属牌组 id。 */
  groupId: string;
  /** 卡片类型。 */
  type: CardType;
  /** 正反面内容，由仓储序列化后落库。 */
  fields: CardFields;
  /** 标签，由仓储序列化后落库。 */
  tags: string[];
  /** 创建时间；省略时由数据库生成。 */
  createdAt?: number;
  /** 最后修改时间。 */
  updatedAt: number;
  /** 下一次可复习时间，Unix 毫秒时间戳。 */
  due: number;
  /** FSRS 稳定性参数。 */
  stability: number;
  /** FSRS 难度参数。 */
  difficulty: number;
  /** 上次复习距今经过的天数。 */
  elapsedDays: number;
  /** 上次复习排定的间隔天数。 */
  scheduledDays: number;
  /** 当前学习步骤编号。 */
  learningSteps: number;
  /** 累计复习次数。 */
  reps: number;
  /** 遗忘后重新学习的次数。 */
  lapses: number;
  /** FSRS 卡片状态。 */
  state: CardState;
  /** 最近一次复习时间；未复习为 null。 */
  lastReview: number | null;
}

/** 复习后要回写的 FSRS 状态，不含内容字段。 */
export type CardSchedule = Pick<
  CardWrite,
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'elapsedDays'
  | 'scheduledDays'
  | 'learningSteps'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'lastReview'
>;

/** 卡片列表可排序的字段，均为 cards 表上的普通列。 */
export type CardSortField = 'createdAt' | 'updatedAt' | 'due' | 'difficulty' | 'reps';

/** 单个排序规则。 */
export interface CardSortRule {
  /** 排序字段。 */
  field: CardSortField;
  /** 排序方向。 */
  order: 'asc' | 'desc';
}

/** 卡片列表查询条件；各条件之间是与的关系，省略则不参与过滤。 */
export interface CardQuery {
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

/** 分页查询结果，`total` 是满足条件的总数、不受分页影响。 */
export interface CardPage {
  /** 当前页的卡片。 */
  cards: CardEntity[];
  /** 满足条件的卡片总数。 */
  total: number;
}
