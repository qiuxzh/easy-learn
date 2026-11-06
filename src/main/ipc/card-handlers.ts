import { IpcChannel } from '@shared/ipc-channels';
import type {
  CardDto,
  CardGroupSummaryDto,
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
import type { CardEntity, CardGroupSummary } from '@main/contracts/card';
import type { FlashcardService } from '@main/service/flashcard-service';
import { registerHandler } from './register-handler';

/** 领域实体转换成渲染层契约；两边形状目前一致，映射点是将来分叉时唯一要改的地方。 */
function toCardDto(card: CardEntity): CardDto {
  return { ...card };
}

/** 牌组摘要转换成渲染层契约。 */
function toGroupDto(group: CardGroupSummary): CardGroupSummaryDto {
  return { ...group };
}

/**
 * 注册闪卡相关的 IPC 处理器。
 *
 * 只做请求转发与响应组装，业务规则在 `FlashcardService` 里。
 *
 * @param cardService 闪卡服务，由装配根创建并注入
 */
export function registerCardHandlers(cardService: FlashcardService): void {
  registerHandler(IpcChannel.Card_ListGroups, () => ({
    groups: cardService.listGroups().map(toGroupDto),
  }));

  registerHandler<CreateCardGroupRequest>(IpcChannel.Card_CreateGroup, request => ({
    group: toGroupDto(cardService.createGroup(request)),
  }));

  registerHandler<RenameCardGroupRequest>(IpcChannel.Card_RenameGroup, request => ({
    group: toGroupDto(cardService.renameGroup(request)),
  }));

  registerHandler<DeleteCardGroupRequest>(IpcChannel.Card_DeleteGroup, request => {
    cardService.deleteGroup(request);
    return {};
  });

  registerHandler<ListCardsRequest>(IpcChannel.Card_ListCards, request => {
    const { cards, tags } = cardService.listCards(request);
    return { cards: cards.map(toCardDto), tags };
  });

  registerHandler<GetCardRequest>(IpcChannel.Card_GetCard, request => ({
    card: toCardDto(cardService.getCard(request)),
  }));

  registerHandler<SaveCardRequest>(IpcChannel.Card_SaveCard, request => ({
    card: toCardDto(cardService.saveCard(request)),
  }));

  registerHandler<DeleteCardRequest>(IpcChannel.Card_DeleteCard, request => {
    cardService.deleteCard(request);
    return {};
  });

  registerHandler<ReviewQueueRequest>(IpcChannel.Card_GetReviewQueue, request => ({
    cards: cardService.getReviewQueue(request).map(toCardDto),
  }));

  registerHandler<ReviewCardRequest>(IpcChannel.Card_ReviewCard, request => ({
    card: toCardDto(cardService.reviewCard(request)),
  }));
}
