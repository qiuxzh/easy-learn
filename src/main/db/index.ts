import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { join } from 'path';
import log from 'electron-log';
import * as schema from './schema';
import { tableSQLs } from './schema';
import { Constants } from '../constants';

let db: ReturnType<typeof drizzle> | null = null;

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function initDatabase(): void {
  const dbPath = join(Constants.dataDir, 'easy-learn.db');
  log.info('Database path:', dbPath);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  for (const sql of tableSQLs) {
    sqlite.exec(sql);
  }

  db = drizzle(sqlite, { schema });

  log.info('Database initialized');
}
