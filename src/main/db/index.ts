/**
 * 数据库入口。模块内持有两个句柄，对应两种用法：
 *
 * - `db`（drizzle）—— **固定表**的读写。表结构在 `schema/` 里静态声明过，
 *   能拿到类型推导与查询构造器，repo 层的绝大多数操作走它。
 * - `sqlite`（better-sqlite3 原始实例）—— drizzle 表达不了的两件事：
 *   ① 加载 SQLite 扩展（sqlite-vector）；
 *   ② 读写按模型在运行时创建、**表名不固定**的向量表。
 *
 * 选择原则：能在 `schema/` 里静态声明列的表用 `getDatabase()`，其余一律用 `getRawDatabase()`。
 * 两者共用同一条连接，所以语句互相可见，也能在同一个事务里混用（见 `runInTransaction`）。
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { join } from 'path';
import log from 'electron-log';
import * as schema from './schema';
import { tableSQLs } from './schema';
import { Constants } from '../constants';

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: SqliteDatabase | null = null;

/**
 * 取 drizzle 实例：**固定表**的读写入口。
 *
 * `schema/` 里声明过列的表都用这个——能拿到字段类型推导、where / join / 聚合，
 * 也不必自己拼表名。向量表不在此列，它见 `getRawDatabase()`。
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * 取 better-sqlite3 原始实例：**只有两件事**需要绕过 drizzle。
 *
 * 1. 加载 SQLite 扩展（sqlite-vector 的 `loadExtension`）；
 * 2. 读写向量表——它按模型在运行时创建、表名不固定（`embed_vec_<维度>_<指纹前16位>`），
 *    drizzle 的静态 schema 表达不了这种表。
 *
 * 它能执行任意 SQL，代价是没有类型检查，所以只应出现在 repo 层，不要从业务代码直接调。
 */
export function getRawDatabase(): SqliteDatabase {
  if (!sqlite) {
    throw new Error('Database not initialized');
  }
  return sqlite;
}

/**
 * 在一个事务里执行。
 *
 * 回调内可以混用 drizzle 语句与原始 SQL——两个句柄共用同一条连接，所以都在本事务内。
 * 注意 better-sqlite3 的 `transaction()` 返回的是函数而不是执行结果，因此末尾要再调一次。
 *
 * @example
 * // 写向量走原始 SQL，累加进度走 drizzle，两者必须同事务
 * runInTransaction(() => {
 *   embedVectorRepo.insertBatch(ref, batch);
 *   embedTaskRepo.addDone({ bookId, embedIndexId, total, delta: batch.length });
 * });
 */
export function runInTransaction<T>(fn: () => T): T {
  return getRawDatabase().transaction(fn)();
}

/**
 * 丢掉主键不是 `book_id` 的 `embed_task`。
 *
 * 这张表必须满足「一本书一行」（见 `schema/embed-task.ts`），主键对不上就说明库文件
 * 里的结构与本文件声明的不同。它是**派生数据**——向量表才是事实源——所以直接丢掉
 * 比写 ALTER 搬那些行安全：主键对不上意味着行数与书不再是「一本一行」的关系，
 * 搬过来也没有意义。丢掉之后启动时的 `reconcileEmbeddingProgress()` 会按向量表重建。
 */
function dropLegacyEmbedTask(instance: SqliteDatabase): void {
  const exists = instance
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embed_task'`)
    .get();
  if (!exists) return;

  const columns = instance.prepare(`PRAGMA table_info(embed_task)`).all() as Array<{
    name: string;
    pk: number;
  }>;
  const primaryKey = columns
    .filter(column => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(column => column.name);
  if (primaryKey.length === 1 && primaryKey[0] === 'book_id') return;

  log.info('[DB] embed_task 的主键不是 book_id，丢弃后按向量表重建');
  instance.exec('DROP TABLE embed_task');
}

/**
 * 打开数据库、建表、装配两个句柄。应用启动时调用一次。
 *
 * 两个句柄在这里一起赋值，保证「拿得到 drizzle 就一定能拿到原始实例」，
 * 不会出现一个有值另一个还是 null 的中间状态。
 */
export function initDatabase(): void {
  const dbPath = join(Constants.dataDir, 'easy-learn.db');
  log.info('Database path:', dbPath);

  // 局部变量不能沿用模块级的 sqlite 名字，否则会遮蔽它、导致下面无法赋值
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  dropLegacyEmbedTask(instance);

  for (const sql of tableSQLs) {
    instance.exec(sql);
  }

  sqlite = instance;
  db = drizzle(instance, { schema });

  log.info('Database initialized');
}
