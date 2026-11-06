import type { Repos } from '@main/infra/repo/repos';
import { FlashcardService } from './flashcard-service';

/** 卡片模块对外暴露的能力。 */
export interface CardModule {
  /** 闪卡业务服务。 */
  cardService: FlashcardService;
}

/**
 * 创建卡片模块。
 *
 * 仓储由装配根一次创建后传入；模块只负责把服务组装起来。
 *
 * @param deps 全应用仓储集合
 */
export function createCardModule(deps: { repos: Repos }): CardModule {
  return {
    cardService: new FlashcardService({
      cardRepo: deps.repos.cardRepo,
      cardGroupRepo: deps.repos.cardGroupRepo,
    }),
  };
}
