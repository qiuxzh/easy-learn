import { bookTable, bookSQL } from './book';
import { bookChunkTable, bookChunkSQL, bookChunkBookIdIndexSQL } from './book-chunk';
import { bookStageTable, bookStageSQL } from './book-stage';
import { bookPageTable, bookPageSQL } from './book-page';
import {
  resourceTable,
  resourceSQL,
  resourceParentIndexSQL,
  resourceParentNameIndexSQL,
} from './resource';
import { attachmentTable, attachmentSQL } from './attachment';
import {
  cardGroupTable,
  cardGroupSQL,
  cardTable,
  cardSQL,
  cardGroupIdIndexSQL,
  cardDueIndexSQL,
} from './flashcard';
import {
  agentSessionTable,
  agentSessionSQL,
  agentSessionUpdatedAtIndexSQL,
  agentSessionTipIndexSQL,
} from './agent-session';
import { agentEntryTable, agentEntrySQL, agentEntryParentIndexSQL } from './agent-entry';
import {
  embedIndexTable,
  embedIndexSQL,
  embedIndexFingerprintIndexSQL,
  embedIndexModelIndexSQL,
} from './embed-index';
import { taskTable, taskSQL, taskTypeStatusCreatedIndexSQL } from './task';
import { resourceOcrPageTable, resourceOcrPageSQL } from './resource-ocr-page';
import {
  resourceChunkTable,
  resourceChunkSQL,
  resourceChunkResourceIdxUniqueSQL,
} from './resource-chunk';

export {
  bookTable,
  bookChunkTable,
  bookStageTable,
  bookPageTable,
  cardGroupTable,
  cardTable,
  agentSessionTable,
  agentEntryTable,
  embedIndexTable,
  attachmentTable,
  resourceTable,
  taskTable,
  resourceOcrPageTable,
  resourceChunkTable,
};
export type { BookRow, InsertBookRow } from './book';
export type { BookChunkRow, InsertBookChunkRow } from './book-chunk';
export type { BookStage, BookStageRow, InsertBookStageRow } from './book-stage';
export type { BookPageRow, InsertBookPageRow } from './book-page';
export type { ResourceRow, InsertResourceRow } from './resource';
export type { AttachmentRow, InsertAttachmentRow } from './attachment';
export type { CardGroupRow, InsertCardGroupRow, CardRow, InsertCardRow } from './flashcard';
export type { AgentSessionRow, InsertAgentSessionRow } from './agent-session';
export type { AgentEntryRow, InsertAgentEntryRow } from './agent-entry';
export type { EmbedIndexRow, InsertEmbedIndexRow } from './embed-index';
export type { TaskRow, InsertTaskRow } from './task';
export type { ResourceOcrPageRow, InsertResourceOcrPageRow } from './resource-ocr-page';
export type { ResourceChunkRow, InsertResourceChunkRow } from './resource-chunk';

export const tableSQLs = [
  bookSQL,
  bookChunkSQL,
  bookChunkBookIdIndexSQL,
  bookStageSQL,
  bookPageSQL,
  attachmentSQL,
  cardGroupSQL,
  cardSQL,
  cardGroupIdIndexSQL,
  cardDueIndexSQL,
  agentSessionSQL,
  agentSessionUpdatedAtIndexSQL,
  agentSessionTipIndexSQL,
  agentEntrySQL,
  agentEntryParentIndexSQL,
  embedIndexSQL,
  embedIndexFingerprintIndexSQL,
  embedIndexModelIndexSQL,
  resourceSQL,
  resourceParentIndexSQL,
  resourceParentNameIndexSQL,
  taskSQL,
  taskTypeStatusCreatedIndexSQL,
  resourceOcrPageSQL,
  resourceChunkSQL,
  resourceChunkResourceIdxUniqueSQL,
];
