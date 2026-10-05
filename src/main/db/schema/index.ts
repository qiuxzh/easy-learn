import { bookTable, bookSQL } from './book';
import { bookChunkTable, bookChunkSQL, bookChunkBookIdIndexSQL } from './book-chunk';
import {
  cardGroupTable,
  cardGroupSQL,
  cardTable,
  cardSQL,
  cardGroupIdIndexSQL,
  cardDueIndexSQL,
} from './flashcard';
import { agentSessionTable, agentSessionSQL, agentSessionUpdatedAtIndexSQL } from './agent-session';
import { agentEntryTable, agentEntrySQL, agentEntrySessionSeqIndexSQL } from './agent-entry';

export { bookTable, bookChunkTable, cardGroupTable, cardTable, agentSessionTable, agentEntryTable };
export type { BookRow, InsertBookRow } from './book';
export type { BookChunkRow, InsertBookChunkRow } from './book-chunk';
export type { CardGroupRow, InsertCardGroupRow, CardRow, InsertCardRow } from './flashcard';
export type { AgentSessionRow, InsertAgentSessionRow } from './agent-session';
export type { AgentEntryRow, InsertAgentEntryRow } from './agent-entry';

export const tableSQLs = [
  bookSQL,
  bookChunkSQL,
  bookChunkBookIdIndexSQL,
  cardGroupSQL,
  cardSQL,
  cardGroupIdIndexSQL,
  cardDueIndexSQL,
  agentSessionSQL,
  agentSessionUpdatedAtIndexSQL,
  agentEntrySQL,
  agentEntrySessionSeqIndexSQL,
];
