export type {
  EmbedCallOptions,
  EmbedClientConfig,
  EmbedFailure,
  EmbedResult,
  EmbedSuccess,
} from './types';
export { embedTexts } from './embedding-client';
export { readActiveEntry, resolveActiveModel } from './embedding-model';
export type { ActiveEntry, EmbedIndexRef, ResolvedModel } from './embedding-model';
export { BookEmbeddingQueue, estimateProgress, runBookEmbedding } from './embedding-runner';
export type {
  BookEmbeddingQueueEvents,
  ProgressEstimate,
  RateSample,
  RunContext,
  RunOutcome,
  RunProgress,
} from './embedding-runner';
