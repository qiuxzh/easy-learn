import type { DbHandle } from '@main/infra/db/connection';
import type { AttachmentRepo } from '@main/contracts/attachment-repo';
import type { CardGroupRepo, CardRepo } from '@main/contracts/card-repo';
import type { SessionEntryRepo, SessionRepo } from '@main/contracts/session-repo';
import type {
  BookChunkRepo,
  BookEmbeddingRepo,
  BookPageRepo,
  BookRepo,
  BookStageRepo,
  EmbedIndexRepo,
  EmbedVectorRepo,
} from '@main/contracts/book-repo';
import { createAttachmentRepo } from './create-attachment-repo';
import { createBookChunkRepo } from './create-book-chunk-repo';
import { createBookEmbeddingRepo } from './create-book-embedding-repo';
import { createBookPageRepo } from './create-book-page-repo';
import { createBookRepo } from './create-book-repo';
import { createBookStageRepo } from './create-book-stage-repo';
import { createCardGroupRepo } from './create-card-group-repo';
import { createCardRepo } from './create-card-repo';
import { createEmbedIndexRepo } from './create-embed-index-repo';
import { createEmbedVectorRepo } from './create-embed-vector-repo';
import { createSessionEntryRepo } from './create-session-entry-repo';
import { createSessionRepo } from './create-session-repo';

/** 全应用的仓储集合，由装配根一次创建后传给各模块。 */
export interface Repos {
  attachmentRepo: AttachmentRepo;
  cardRepo: CardRepo;
  cardGroupRepo: CardGroupRepo;
  sessionRepo: SessionRepo;
  sessionEntryRepo: SessionEntryRepo;
  bookRepo: BookRepo;
  bookChunkRepo: BookChunkRepo;
  bookPageRepo: BookPageRepo;
  bookStageRepo: BookStageRepo;
  bookEmbeddingRepo: BookEmbeddingRepo;
  embedIndexRepo: EmbedIndexRepo;
  embedVectorRepo: EmbedVectorRepo;
}

/** 书籍域用到的仓储视图。 */
export type BookRepos = Pick<
  Repos,
  | 'bookRepo'
  | 'bookChunkRepo'
  | 'bookPageRepo'
  | 'bookStageRepo'
  | 'bookEmbeddingRepo'
  | 'embedIndexRepo'
  | 'embedVectorRepo'
>;

/**
 * 创建全应用的仓储。
 *
 * 所有仓储在这里一次建好；模块只接收 `Repos`，不再自己建仓储。
 *
 * @param db 数据库句柄，由装配根持有
 */
export function createRepos(db: DbHandle): Repos {
  const bookStageRepo = createBookStageRepo(db);
  const embedIndexRepo = createEmbedIndexRepo(db);
  const embedVectorRepo = createEmbedVectorRepo(db);

  return {
    attachmentRepo: createAttachmentRepo(db),
    cardRepo: createCardRepo(db),
    cardGroupRepo: createCardGroupRepo(db),
    sessionRepo: createSessionRepo(db),
    sessionEntryRepo: createSessionEntryRepo(db),
    bookRepo: createBookRepo(db),
    bookChunkRepo: createBookChunkRepo(db),
    bookPageRepo: createBookPageRepo(db),
    bookStageRepo,
    bookEmbeddingRepo: createBookEmbeddingRepo(db, {
      bookStageRepo,
      embedIndexRepo,
      embedVectorRepo,
    }),
    embedIndexRepo,
    embedVectorRepo,
  };
}
