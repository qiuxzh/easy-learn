import type { Repos } from '@main/infra/repo/repos';
import type { UiEventPublisher } from '@main/contracts/ui-event-publisher';
import type { ModelConfig } from '@main/contracts/model-config';
import type { AttachmentService } from '@main/service/attachment-service';
import type { LibraryService } from '@main/service/library/library-service';
import type { ResourceReaderService } from '@main/service/library/resource-reader-service';
import type { CardModule } from '@main/service/create-card-module';
import { createSessionLog } from '@main/agent/common-agent/session-manager';
import type { AgentDefinition } from '@main/agent/common-agent/agent-definition';
import { SessionService } from './session-service';
import { createReadingAgent } from './reading-agent';
import { createResourceTools } from './tools/resource-tools';
import { createFlashcardTools } from './tools/flashcard-tools';

/** chat 模块对外暴露的能力。 */
export interface ChatModule {
  /** 会话服务。 */
  sessionService: SessionService;
  /** 阅读智能体定义（系统提示 + 工具集）。 */
  definition: AgentDefinition;
}

/** 创建 chat 模块所需的依赖。 */
export interface ChatModuleDeps {
  /** 全应用仓储集合。 */
  repos: Repos;
  /** 附件服务。 */
  attachmentService: AttachmentService;
  /** 资料列表服务。 */
  libraryService: LibraryService;
  /** 资料读取服务。 */
  resourceReaderService: ResourceReaderService;
  /** 卡片模块。 */
  cardModule: CardModule;
  /** 模型配置来源。 */
  modelConfig: ModelConfig;
  /** 事件出口。 */
  events: UiEventPublisher;
}

/**
 * 创建 chat 模块：工具、智能体定义与会话服务都在模块内组装。
 *
 * 仓储由装配根创建后传入；工具依赖的资料列表、读取与卡片服务在模块内装配，
 * 装配根不参与工具装配。
 *
 * @param deps 装配根提供的会话仓储、附件服务、资料列表与读取服务、卡片模块、模型配置
 */
export function createChatModule(deps: ChatModuleDeps): ChatModule {
  const definition = createReadingAgent([
    ...createResourceTools({
      libraryService: deps.libraryService,
      resourceReaderService: deps.resourceReaderService,
    }),
    ...createFlashcardTools({ cardService: deps.cardModule.cardService }),
  ]);

  const session = new SessionService({
    sessionRepo: deps.repos.sessionRepo,
    log: createSessionLog({
      sessionRepo: deps.repos.sessionRepo,
      entryRepo: deps.repos.sessionEntryRepo,
    }),
    attachmentService: deps.attachmentService,
    modelConfig: deps.modelConfig,
    events: deps.events,
    definition,
  });

  return { sessionService: session, definition };
}
