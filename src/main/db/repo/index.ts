export { bookRepo, BookRepo } from './book-repo';
export { bookChunkRepo, BookChunkRepo } from './book-chunk-repo';
export { bookEmbeddingRepo, BookEmbeddingRepo } from './book-embedding-repo';
export type { BookRow, InsertBookRow } from '../schema';
export type { BookChunkRow, InsertBookChunkRow } from '../schema';
export {
  flashcardRepo,
  FlashcardRepo,
  countCards,
  toCardGroupSummary,
  toCardRecord,
} from './flashcard-repo';
export type { CardGroupCounts, CardWriteData } from './flashcard-repo';
export { agentSessionRepo, AgentSessionRepo } from './agent-session-repo';
export { agentEntryRepo, AgentEntryRepo } from './agent-entry-repo';
export type { AgentSessionRow, InsertAgentSessionRow } from '../schema';
export type { AgentEntryRow, InsertAgentEntryRow } from '../schema';
export type { BookChunkCount } from './book-chunk-repo';
export { embedIndexRepo, EmbedIndexRepo } from './embed-index-repo';
export { embedTaskRepo, EmbedTaskRepo } from './embed-task-repo';
export type { EmbedTaskScope } from './embed-task-repo';
export { embedVectorRepo, EmbedVectorRepo } from './embed-vector-repo';
export type {
  EmbedSourceType,
  VectorTableRef,
  PendingChunk,
  InsertVectorRow,
  VectorCountBySource,
  VectorSearchHit,
} from './embed-vector-repo';
export type { EmbedIndexRow, InsertEmbedIndexRow } from '../schema';
export type { EmbedTaskRow, InsertEmbedTaskRow } from '../schema';
