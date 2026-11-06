/**
 * 数据库入口。
 *
 * `db` 是 drizzle 实例，负责固定表的读写：表结构在 `schema/` 里静态声明，能拿到类型推导
 * 与查询构造器，repo 层绝大多数操作走它。`sqlite` 是 better-sqlite3 原始实例，只用于
 * drizzle 表达不了的两件事：加载 sqlite-vector 扩展，以及读写运行时创建、表名不固定的
 * 向量表。
 *
 * 句柄由装配根持有并注入；本模块不保存模块级连接，避免仓储越过构造参数去取全局状态。
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import log from 'electron-log';
import * as schema from './schema';
import { tableSQLs } from './schema';
import { loadVectorExtension } from './vector-extension';

/** drizzle 实例类型，绑定 `schema/` 里声明的全部表。 */
export type DrizzleDatabase = BetterSQLite3Database<typeof schema>;

/**
 * 一条数据库连接的句柄。
 *
 * `db` 与 `sqlite` 共用同一条连接，语句互相可见，也能在同一个事务里混用。
 */
export interface DbHandle {
  /** drizzle 实例，用于固定表的读写。 */
  readonly db: DrizzleDatabase;
  /** better-sqlite3 原始实例，只用于加载扩展与读写向量表。 */
  readonly sqlite: SqliteDatabase;
  /**
   * 在事务里执行；回调内混用 drizzle 与原始 SQL 都落在同一事务。
   *
   * 已在事务中时直接并入外层，不另开保存点，因此没有局部回滚：内层抛错会让整个外层回滚。
   * 回调必须是同步函数——返回 Promise 会抛错，否则后续语句会跑到事务外。
   */
  transaction<T>(fn: () => T): T;
}

/**
 * 打开一条连接：建表、装配两个句柄。
 *
 * 仓储测试用它打开 `:memory:` 库；正式启动由 `initDatabase()` 调用。
 *
 * @param dbPath 数据库文件路径，传 `:memory:` 得到进程内内存库
 * @param options.withVector 是否加载 sqlite-vector 扩展；内存库与不涉及向量的测试传 false
 * @throws 路径不可写、建表失败、扩展路径解析失败之外的连接错误都会抛出
 */
export function openDatabase(dbPath: string, options: { withVector?: boolean } = {}): DbHandle {
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  for (const sql of tableSQLs) {
    instance.exec(sql);
  }

  // 扩展是连接级的，必须与连接的创建绑在一起；加载失败不抛，检索侧会降级
  if (options.withVector !== false) {
    loadVectorExtension(instance);
  }

  return {
    db: drizzle(instance, { schema }),
    sqlite: instance,
    transaction: <T>(fn: () => T): T => {
      const run = (): T => {
        const result = fn();
        if (result instanceof Promise) {
          throw new Error('事务回调必须是同步函数');
        }
        return result;
      };
      if (instance.inTransaction) return run();
      return instance.transaction(run)();
    },
  };
}

/**
 * 打开数据库并装配句柄。应用启动时调用一次，返回值交给装配根持有。
 *
 * @param dbPath 数据库文件路径，由启动流程从路径集合里取
 * @throws 连接失败或建表失败
 */
export function initDatabase(dbPath: string): DbHandle {
  log.info('Database path:', dbPath);

  const handle = openDatabase(dbPath);

  log.info('Database initialized');
  return handle;
}
