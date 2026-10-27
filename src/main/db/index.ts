/**
 * 数据库入口。模块内持有两个句柄。
 *
 * `db` 是 drizzle 实例，负责固定表的读写：表结构在 `schema/` 里静态声明，能拿到类型推导
 * 与查询构造器，repo 层绝大多数操作走它。`sqlite` 是 better-sqlite3 原始实例，只用于
 * drizzle 表达不了的两件事：加载 sqlite-vector 扩展，以及读写运行时创建、表名不固定的
 * 向量表。
 *
 * 能在 `schema/` 里静态声明列的表用 `getDatabase()`，其余一律用 `getRawDatabase()`。
 * 两者共用同一条连接，语句互相可见，也能在同一个事务里混用（见 `runInTransaction`）。
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { join } from 'path';
import log from 'electron-log';
import * as schema from './schema';
import { tableSQLs } from './schema';
import { Constants } from '../constants';
import { loadVectorExtension } from './vector-extension';

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: SqliteDatabase | null = null;

/**
 * 取 drizzle 实例，用于固定表的读写。
 *
 * `schema/` 里声明过列的表都用这个，能拿到字段类型推导、where、join 与聚合，
 * 也不必自己拼表名。向量表不在此列，见 `getRawDatabase()`。
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * 取 better-sqlite3 原始实例，只用于加载 sqlite-vector 扩展与读写运行时创建的向量表。
 *
 * 向量表按模型在运行时创建，表名不固定（`embed_vec_<维度>_<指纹前16位>`），drizzle 的
 * 静态 schema 表达不了。它能执行任意 SQL，代价是没有类型检查，所以只应出现在 repo 层，
 * 不要从业务代码直接调。
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
 *   bookStageRepo.addEmbedDone({ bookId, total, identity, delta: batch.length });
 * });
 */
export function runInTransaction<T>(fn: () => T): T {
  return getRawDatabase().transaction(fn)();
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

  for (const sql of tableSQLs) {
    instance.exec(sql);
  }

  sqlite = instance;
  db = drizzle(instance, { schema });

  // 扩展是连接级的，必须与连接的创建绑在一起；加载失败不抛，检索侧会降级
  loadVectorExtension(instance);

  log.info('Database initialized');
}
