import { ipcMain } from 'electron';
import { fsrs, Rating, State, createEmptyCard } from 'ts-fsrs';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  CardGroupListResult,
  CardGroupResult,
  CardListResult,
  CardResult,
  CardRecord,
  CardState,
  CardFields,
  CreateCardGroupRequest,
  DeleteCardGroupRequest,
  DeleteCardRequest,
  GetCardRequest,
  ListCardsRequest,
  RenameCardGroupRequest,
  ReviewCardRequest,
  ReviewQueueRequest,
  SaveCardRequest,
} from '@shared/types/flashcards';
import { BaseService } from '../service/base-service';
import { flashcardRepo, toCardGroupSummary, toCardRecord, type CardWriteData } from '../db/repo';

const scheduler = fsrs();

/** FSRS 评分名称到 ts-fsrs 枚举的映射。 */
const RATING_MAP = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

/** 闪卡业务服务，负责牌组、卡片和复习状态的持久化。 */
export class FlashcardService extends BaseService {
  /** 注册闪卡 IPC 处理器。 */
  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Card_ListGroups, (): CardGroupListResult => this.listGroups());
    ipcMain.handle(
      IpcChannel.Card_CreateGroup,
      (_, request: CreateCardGroupRequest): CardGroupResult => this.createGroup(request)
    );
    ipcMain.handle(
      IpcChannel.Card_RenameGroup,
      (_, request: RenameCardGroupRequest): CardGroupResult => this.renameGroup(request)
    );
    ipcMain.handle(
      IpcChannel.Card_DeleteGroup,
      (_, request: DeleteCardGroupRequest): CardGroupResult => this.deleteGroup(request)
    );
    ipcMain.handle(
      IpcChannel.Card_ListCards,
      (_, request: ListCardsRequest): CardListResult => this.listCards(request)
    );
    ipcMain.handle(
      IpcChannel.Card_GetCard,
      (_, request: GetCardRequest): CardResult => this.getCard(request)
    );
    ipcMain.handle(
      IpcChannel.Card_SaveCard,
      (_, request: SaveCardRequest): CardResult => this.saveCard(request)
    );
    ipcMain.handle(
      IpcChannel.Card_DeleteCard,
      (_, request: DeleteCardRequest): CardResult => this.deleteCard(request)
    );
    ipcMain.handle(
      IpcChannel.Card_GetReviewQueue,
      (_, request: ReviewQueueRequest): CardListResult => this.getReviewQueue(request)
    );
    ipcMain.handle(
      IpcChannel.Card_ReviewCard,
      (_, request: ReviewCardRequest): CardResult => this.reviewCard(request)
    );
  }

  /** 查询牌组和统计数据。 */
  listGroups(): CardGroupListResult {
    try {
      const cards = flashcardRepo.findAllCards().map(toCardRecord);
      const groups = flashcardRepo.findGroups().map(group =>
        toCardGroupSummary(
          group,
          cards.filter(card => card.groupId === group.id)
        )
      );
      return { success: true, groups };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 新增牌组。 */
  createGroup(request: CreateCardGroupRequest): CardGroupResult {
    const name = request.name.trim();
    if (!name) return { success: false, error: '牌组名称不能为空' };
    try {
      const group = flashcardRepo.createGroup(name);
      return { success: true, group: toCardGroupSummary(group, []) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 修改牌组名称。 */
  renameGroup(request: RenameCardGroupRequest): CardGroupResult {
    const name = request.name.trim();
    if (!name) return { success: false, error: '牌组名称不能为空' };
    try {
      const group = flashcardRepo.renameGroup(request.id, name);
      if (!group) return { success: false, error: '牌组不存在' };
      const cards = flashcardRepo.findCardsByGroupId(group.id).map(toCardRecord);
      return { success: true, group: toCardGroupSummary(group, cards) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 删除牌组及其卡片。 */
  deleteGroup(request: DeleteCardGroupRequest): CardGroupResult {
    try {
      if (!flashcardRepo.findGroupById(request.id)) return { success: false, error: '牌组不存在' };
      flashcardRepo.deleteGroup(request.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 查询卡片和全局标签。 */
  listCards(request: ListCardsRequest): CardListResult {
    try {
      const cards = flashcardRepo.findCards(request.groupId, request.tag).map(toCardRecord);
      const tags = collectTags(flashcardRepo.findAllCards().map(toCardRecord));
      return { success: true, cards, tags };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 查询单张卡片。 */
  getCard(request: GetCardRequest): CardResult {
    try {
      const card = flashcardRepo.findCardById(request.id);
      return card
        ? { success: true, card: toCardRecord(card) }
        : { success: false, error: '卡片不存在' };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 新增或覆盖保存卡片内容。 */
  saveCard(request: SaveCardRequest): CardResult {
    try {
      const group = flashcardRepo.findGroupById(request.groupId);
      if (!group) return { success: false, error: '牌组不存在' };
      validateFields(request.fields);
      const tags = normalizeTags(request.tags);
      const existing = request.id ? flashcardRepo.findCardById(request.id) : undefined;
      if (request.id && !existing) return { success: false, error: '卡片不存在' };

      const now = Date.now();
      const initial = existing
        ? toCardRecord(existing)
        : createEmptyCard(new Date(now), card => ({
            type: 'basic' as const,
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
          }));
      const data: CardWriteData = {
        id: request.id,
        groupId: request.groupId,
        type: request.type ?? initial.type,
        fields: request.fields,
        tags,
        createdAt: existing?.createdAt,
        updatedAt: now,
        due: initial.due,
        stability: initial.stability,
        difficulty: initial.difficulty,
        elapsedDays: initial.elapsedDays,
        scheduledDays: initial.scheduledDays,
        learningSteps: initial.learningSteps,
        reps: initial.reps,
        lapses: initial.lapses,
        state: initial.state,
        lastReview: initial.lastReview,
      };
      const saved = existing
        ? flashcardRepo.updateCardContent(data)
        : flashcardRepo.createCard(data);
      return saved
        ? { success: true, card: toCardRecord(saved) }
        : { success: false, error: '保存卡片失败' };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 删除单张卡片。 */
  deleteCard(request: DeleteCardRequest): CardResult {
    try {
      if (!flashcardRepo.findCardById(request.id)) return { success: false, error: '卡片不存在' };
      flashcardRepo.deleteCard(request.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 获取指定牌组的复习队列。 */
  getReviewQueue(request: ReviewQueueRequest): CardListResult {
    try {
      if (!flashcardRepo.findGroupById(request.groupId))
        return { success: false, error: '牌组不存在' };
      const cards = flashcardRepo.findReviewQueue(request.groupId).map(toCardRecord);
      return { success: true, cards };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /** 使用 FSRS 记录评分并保存新的复习状态。 */
  reviewCard(request: ReviewCardRequest): CardResult {
    try {
      const row = flashcardRepo.findCardById(request.id);
      if (!row) return { success: false, error: '卡片不存在' };
      const current = toCardRecord(row);
      const next = scheduler.next(toFsrsCard(current), new Date(), RATING_MAP[request.rating]);
      const updated = flashcardRepo.updateCardSchedule(request.id, {
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
      });
      return updated
        ? { success: true, card: toCardRecord(updated) }
        : { success: false, error: '保存复习状态失败' };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }
}

/** 将持久化卡片转换为 ts-fsrs 输入对象。 */
function toFsrsCard(card: CardRecord) {
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

/** 对标签去空格、去重，并过滤空标签。 */
function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}

/** 收集所有卡片中的标签并按字典序排列。 */
function collectTags(cards: CardRecord[]): string[] {
  return [...new Set(cards.flatMap(card => card.tags))].sort((left, right) =>
    left.localeCompare(right)
  );
}

/** 校验卡片的正反面内容。 */
function validateFields(fields: CardFields): void {
  if (!fields.front.trim()) throw new Error('卡片正面不能为空');
  if (!fields.back.trim()) throw new Error('卡片反面不能为空');
}

/** 将未知异常统一转换成可展示的错误文本。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const flashcardService = new FlashcardService();
