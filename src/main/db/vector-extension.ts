/**
 * sqlite-vector 扩展（npm 包 `@sqliteai/sqlite-vector`）的接入。
 *
 * 两条约束来自扩展本身，不是我们的选择：
 *
 * - **扩展是连接级的**：`loadExtension` 作用在一条连接句柄上，所以必须和连接的创建绑在一起
 *   （见 `db/index.ts` 的 `initDatabase()`）。换了连接就得重新加载。
 * - **维度声明也是连接级的，而且不落盘**：实测 `vector_init` 前后 db 文件大小、WAL 大小、
 *   `schema_version`、`sqlite_master` 对象数全部不变。所以每次启动都要重新声明一遍，
 *   声明逻辑在 `repo/embed-vector-repo.ts` 的 `ensureVectorIndex` 里按「扫描前懒声明」实现。
 */
import { createRequire } from 'node:module';
import log from 'electron-log';
import type { Database as SqliteDatabase } from 'better-sqlite3';

/**
 * 扩展不可用的原因；null 表示已成功加载。
 *
 * 初值不是 null：在 `initDatabase()` 之前调用检索时，要报「尚未加载」而不是让扩展报
 * 「no such function: vector_init」——后者看不出真正的原因。
 */
let loadFailure: string | null = 'sqlite-vector 扩展尚未加载';

/**
 * 取扩展二进制的绝对路径。
 *
 * **必须走 `@sqliteai/sqlite-vector` 的 CJS 入口**：它的 ESM 产物里 `__require` 是
 * 「拿不到 require 就抛错」的 shim，直接 import 会让 `getExtensionPath()` 必然抛错；
 * 用 createRequire 拿到的 require 解析到 CJS 产物，才能定位平台包里的 dll。
 */
function resolveExtensionPath(): string {
  const requireFromMain = createRequire(import.meta.url);
  const vectorPackage = requireFromMain('@sqliteai/sqlite-vector') as {
    getExtensionPath: () => string;
  };
  return vectorPackage.getExtensionPath();
}

/**
 * 在当前连接上加载扩展。应用启动时调用一次，**失败不抛**。
 *
 * 失败不抛的理由：写入向量的路径完全不需要扩展，某个平台的二进制缺失或被安全软件拦下，
 * 不该让整个应用起不来。原因记在这里，检索侧据此给出人话提示，并让模型改用 BM25。
 */
export function loadVectorExtension(instance: SqliteDatabase): void {
  try {
    instance.loadExtension(resolveExtensionPath());
    loadFailure = null;
    log.info('[DB] sqlite-vector 扩展已加载');
  } catch (error) {
    loadFailure = error instanceof Error ? error.message : String(error);
    log.warn(`[DB] sqlite-vector 扩展加载失败，向量检索不可用：${loadFailure}`);
  }
}

/** 确认扩展可用；不可用时抛错，把「为什么」带到调用方。 */
export function assertVectorExtensionReady(): void {
  if (loadFailure !== null) {
    throw new Error(loadFailure);
  }
}
