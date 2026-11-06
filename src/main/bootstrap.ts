import { initDatabase, type DbHandle } from './infra/db/connection';
import { ConfigService } from './infra/config-service';
import { createUiEventPublisher } from './infra/create-ui-event-publisher';
import { createModelConfig } from './infra/create-model-config';
import { createEmbeddingConfig, createOcrConfig } from './infra/create-config-slices';
import type { Paths } from './paths';
import type { UiEventPublisher } from './contracts/ui-event-publisher';
import type { ModelConfig } from './contracts/model-config';
import type { BookService } from './books/book-service';
import type { BookEmbeddingRunner } from './books/etl/embedding';
import type { BookOcrRunner } from './books/ocr-runner';
import type { FlashcardService } from './service/flashcard-service';
import type { ReadingService } from './service/reading-service';
import type { SessionService } from './chat/session-service';
import { createAttachmentStore } from './infra/attachment-store';
import { createRepos } from './infra/repo/repos';
import { createCardModule } from './service/create-card-module';
import { createReadingModule } from './service/create-reading-module';
import { createBookModule } from './books/create-book-module';
import { createChatModule } from './chat/create-chat-module';
import { EmbeddingService } from './service/embedding-service';
import { AttachmentService } from './service/attachment-service';

/** 装配应用需要的底层输入。 */
export interface AppDeps {
  /** 启动时算好的路径。 */
  readonly paths: Paths;
  /** 已打开的数据库连接；省略时按 `paths.databasePath` 打开。测试可传内存库。 */
  readonly db?: DbHandle;
  /** 事件出口；省略时推送到主窗口。 */
  readonly events?: UiEventPublisher;
  /** 配置中心；省略时按 `paths` 读取 data 目录下的 config.json。测试可传内存实现。 */
  readonly configService?: ConfigService;
  /** 模型配置来源；省略时读配置中心。 */
  readonly modelConfig?: ModelConfig;
}

/** 可供边界层调用的业务服务。 */
export interface AppServices {
  attachmentService: AttachmentService;
  bookService: BookService;
  bookEmbeddingService: BookEmbeddingRunner;
  bookOcrService: BookOcrRunner;
  cardService: FlashcardService;
  embeddingService: EmbeddingService;
  readingService: ReadingService;
  sessionService: SessionService;
}

/** 装配完成的应用。 */
export interface App {
  /** 启动时注入的路径。 */
  readonly paths: Paths;
  /** 配置中心，作为门面供边界层与装配根使用。 */
  readonly configService: ConfigService;
  /** 事件出口。 */
  readonly events: UiEventPublisher;
  /** 业务服务。 */
  readonly services: AppServices;
  /** 释放数据库、会话运行时与配置订阅。应用退出时调用一次。 */
  shutdown(): Promise<void>;
}

/**
 * 装配应用：创建连接与各功能模块，负责按创建的反序释放。
 *
 * 这里只认识模块工厂与 kernel（db / config / events / paths）；
 * 各模块内部的仓储与服务由模块自己组装。
 *
 * @param deps 启动时提供的路径与可选覆盖项
 */
export function bootstrap(deps: AppDeps): App {
  const events = deps.events ?? createUiEventPublisher();
  const configService = deps.configService ?? new ConfigService(deps.paths, events);
  const db = deps.db ?? initDatabase(deps.paths.databasePath);

  const embeddingConfig = createEmbeddingConfig(configService);
  const ocrConfig = createOcrConfig(configService);
  const modelConfig = deps.modelConfig ?? createModelConfig(configService);

  const attachmentStore = createAttachmentStore(deps.paths);
  const repos = createRepos(db);
  const attachmentService = new AttachmentService({
    attachmentRepo: repos.attachmentRepo,
    store: attachmentStore,
  });

  const bookModule = createBookModule({
    repos,
    paths: deps.paths,
    attachmentService,
    embeddingConfig,
    ocrConfig,
    events,
    transaction: fn => db.transaction(fn),
  });
  const cardModule = createCardModule({ repos });
  const readingModule = createReadingModule();
  const chatModule = createChatModule({
    repos,
    attachmentService,
    bookModule,
    cardModule,
    readingService: readingModule.readingService,
    modelConfig,
    events,
  });

  return {
    paths: deps.paths,
    configService,
    events,
    services: {
      attachmentService,
      bookService: bookModule.bookService,
      bookEmbeddingService: bookModule.embeddingService,
      bookOcrService: bookModule.ocrService,
      cardService: cardModule.cardService,
      embeddingService: new EmbeddingService(),
      readingService: readingModule.readingService,
      sessionService: chatModule.sessionService,
    },
    shutdown: async () => {
      await chatModule.sessionService.dispose();
      db.sqlite.close();
    },
  };
}
