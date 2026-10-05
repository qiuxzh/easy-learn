/** 闪卡支持的卡片类型。当前只实现 Basic，保留后续扩展入口。 */
export type CardType = 'basic';

/** FSRS 卡片状态。数值与 ts-fsrs 的 State 枚举保持一致。 */
export type CardState = 0 | 1 | 2 | 3;

/** 复习按钮对应的 FSRS 评分。 */
export type CardReviewRating = 'again' | 'hard' | 'good' | 'easy';

/** 卡片正面与反面的 Markdown 内容。 */
export interface CardFields {
  front: string;
  back: string;
}

/** 牌组记录。 */
export interface CardGroup {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** 牌组统计信息。 */
export interface CardGroupSummary extends CardGroup {
  /** 未学习的新卡数量。 */
  unlearned: number;
  /** 当前到期的学习中卡片数量。 */
  learning: number;
  /** 当前到期的复习卡数量。 */
  due: number;
  /** 卡片总数。 */
  total: number;
}

/** 闪卡记录及 FSRS 复习状态。 */
export interface CardRecord {
  /** 卡片唯一标识。 */
  id: string;
  /** 所属牌组 ID。 */
  groupId: string;
  /** 卡片类型，当前仅支持 basic。 */
  type: CardType;
  /** 正面与反面的 Markdown 内容。 */
  fields: CardFields;
  /** 卡片标签。 */
  tags: string[];
  /** 创建时间，Unix 毫秒时间戳。 */
  createdAt: number;
  /** 最后修改时间，Unix 毫秒时间戳。 */
  updatedAt: number;
  /** 下一次可复习时间，Unix 毫秒时间戳；新卡取创建时刻。 */
  due: number;
  /** 记忆稳定性，对记忆保持能力的估计，数值越大复习间隔越长。 */
  stability: number;
  /** 记忆难度，卡片相对其他卡片的难记程度。 */
  difficulty: number;
  /** 上次复习距今经过的天数。 */
  elapsedDays: number;
  /** 上次复习排定的复习间隔天数。 */
  scheduledDays: number;
  /** 当前处于学习步骤的第几步。 */
  learningSteps: number;
  /** 卡片被复习的总次数。 */
  reps: number;
  /** 卡片遗忘后重新学习的次数。 */
  lapses: number;
  /** 卡片所处阶段，取值见 CardState。 */
  state: CardState;
  /** 最近一次复习时间，未复习的新卡为 null。 */
  lastReview: number | null;
}

/** 创建或编辑卡片的请求参数。 */
export interface SaveCardRequest {
  id?: string;
  groupId: string;
  type?: CardType;
  fields: CardFields;
  tags: string[];
}

/** 创建牌组的请求参数。 */
export interface CreateCardGroupRequest {
  name: string;
}

/** 修改牌组名称的请求参数。 */
export interface RenameCardGroupRequest {
  id: string;
  name: string;
}

/** 删除牌组的请求参数。 */
export interface DeleteCardGroupRequest {
  id: string;
}

/** 查询指定牌组卡片的请求参数。 */
export interface ListCardsRequest {
  groupId?: string;
  tag?: string;
}

/** 查询单张卡片的请求参数。 */
export interface GetCardRequest {
  id: string;
}

/** 删除单张卡片的请求参数。 */
export interface DeleteCardRequest {
  id: string;
}

/** 复习队列查询请求参数。 */
export interface ReviewQueueRequest {
  groupId: string;
}

/** 提交复习评分的请求参数。 */
export interface ReviewCardRequest {
  id: string;
  rating: CardReviewRating;
}

/** 牌组列表响应。 */
export interface CardGroupListResult {
  success: boolean;
  groups?: CardGroupSummary[];
  error?: string;
}

/** 单个牌组操作响应。 */
export interface CardGroupResult {
  success: boolean;
  group?: CardGroupSummary;
  error?: string;
}

/** 卡片列表响应。 */
export interface CardListResult {
  success: boolean;
  cards?: CardRecord[];
  tags?: string[];
  error?: string;
}

/** 单张卡片响应。 */
export interface CardResult {
  success: boolean;
  card?: CardRecord;
  error?: string;
}
