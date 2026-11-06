import type { TransactionRunner } from '@main/contracts/transaction';
import type { BookRepos } from '@main/infra/repo/repos';
import type { BookRetrievalService } from './book-retrieval-service';
import type { ChunkDraft } from './etl/chunking';

/** 替换分片所需的依赖。 */
export interface ReplaceChunksDeps {
  transaction: TransactionRunner;
  repos: BookRepos;
  retrievalService: BookRetrievalService;
}

/**
 * 用一批新的切分产物整体替换一本书的分片。
 *
 * 删旧分片、写新分片、清向量、失效检索缓存在同一个事务里完成；分片一换，
 * 旧向量对应的正文已经不是同一段，留着会让检索返回对不上的内容。
 *
 * @returns 写入的分片数
 */
export function replaceBookChunks(
  deps: ReplaceChunksDeps,
  bookId: string,
  drafts: ChunkDraft[]
): number {
  const count = deps.transaction(() => {
    deps.repos.bookChunkRepo.deleteByBookId(bookId);
    const written = deps.repos.bookChunkRepo.createForBook(bookId, drafts);
    deps.repos.bookStageRepo.writeChunks(bookId, written);
    deps.repos.bookEmbeddingRepo.drop(bookId, null);
    return written;
  });
  deps.retrievalService.invalidate(bookId);
  return count;
}
