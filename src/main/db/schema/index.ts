import { bookTable, bookSQL } from './book';
import { bookChunkTable, bookChunkSQL, bookChunkBookIdIndexSQL } from './book-chunk';
import { bookStageTable, bookStageSQL } from './book-stage';
import { bookPageTable, bookPageSQL } from './book-page';
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
};
export type { BookRow, InsertBookRow } from './book';
export type { BookChunkRow, InsertBookChunkRow } from './book-chunk';
export type { BookStage, BookStageRow, InsertBookStageRow } from './book-stage';
export type { BookPageRow, InsertBookPageRow } from './book-page';
export type { AttachmentRow, InsertAttachmentRow } from './attachment';
export type { CardGroupRow, InsertCardGroupRow, CardRow, InsertCardRow } from './flashcard';
export type { AgentSessionRow, InsertAgentSessionRow } from './agent-session';
export type { AgentEntryRow, InsertAgentEntryRow } from './agent-entry';
export type { EmbedIndexRow, InsertEmbedIndexRow } from './embed-index';

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
];
