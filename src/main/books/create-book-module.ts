import type { Paths } from '@main/paths';
import type { EmbeddingConfig, OcrConfig } from '@main/contracts/config';
import type { TransactionRunner } from '@main/contracts/transaction';
import type { UiEventPublisher } from '@main/contracts/ui-event-publisher';
import type { AttachmentService } from '@main/service/attachment-service';
import type { Repos } from '@main/infra/repo/repos';
import { BookRetrievalService } from './book-retrieval-service';
import { BookReaderService } from './book-reader-service';
import { BookEmbeddingRunner } from '@main/service/etl/embedding';
import { BookOcrRunner } from './ocr-runner';
import { BookService } from './book-service';
import { replaceBookChunks } from './replace-chunks';
import type { ChunkDraft } from '@main/service/etl/chunking';

/** 书籍模块对外暴露的能力。 */
export interface BookModule {
  /** 书籍用例服务。 */
  bookService: BookService;
  /** 阅读侧读取。 */
  readerService: BookReaderService;
  /** 检索。 */
  retrievalService: BookRetrievalService;
  /** 向量化任务编排。 */
  embeddingService: BookEmbeddingRunner;
  /** 文字提取编排。 */
  ocrService: BookOcrRunner;
}

/**
 * 创建书籍模块：检索、正文、阅读与两个后台 runner 都在模块内组装。
 *
 * 仓储由装配根一次创建后传入；模块直接引用 `repos`，只对外暴露 `book/reader/retrieval`。
 *
 * @param deps 装配根提供的仓储、路径、附件服务、配置切片、事件与事务
 */
export function createBookModule(deps: {
  repos: Repos;
  paths: Paths;
  attachmentService: AttachmentService;
  embeddingConfig: EmbeddingConfig;
  ocrConfig: OcrConfig;
  events: UiEventPublisher;
  transaction: TransactionRunner;
}): BookModule {
  const retrieval = new BookRetrievalService({
    repos: deps.repos,
    embeddingConfig: deps.embeddingConfig,
  });
  const reader = new BookReaderService({
    repos: deps.repos,
    attachmentService: deps.attachmentService,
    paths: deps.paths,
  });
  const embedding = new BookEmbeddingRunner({
    transaction: deps.transaction,
    repos: deps.repos,
    embeddingConfig: deps.embeddingConfig,
    events: deps.events,
  });
  const replaceChunks = (bookId: string, drafts: ChunkDraft[]): number =>
    replaceBookChunks(
      { transaction: deps.transaction, repos: deps.repos, retrievalService: retrieval },
      bookId,
      drafts
    );
  const ocr = new BookOcrRunner({
    transaction: deps.transaction,
    repos: deps.repos,
    attachmentService: deps.attachmentService,
    replaceChunks,
    paths: deps.paths,
    ocrConfig: deps.ocrConfig,
    events: deps.events,
  });
  const book = new BookService({
    repos: deps.repos,
    transaction: deps.transaction,
    attachmentService: deps.attachmentService,
    paths: deps.paths,
    bookServices: {
      readerService: reader,
      retrievalService: retrieval,
      embeddingService: embedding,
      ocrService: ocr,
    },
  });

  return {
    bookService: book,
    readerService: reader,
    retrievalService: retrieval,
    embeddingService: embedding,
    ocrService: ocr,
  };
}
