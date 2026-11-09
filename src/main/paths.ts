import path from 'node:path';

/**
 * 应用运行期用到的目录与文件路径。
 *
 * 由启动流程算好后注入，模块不再自己读 electron 的 userData 目录，换环境时只换这一份。
 */
export interface Paths {
  /** 数据根目录。 */
  readonly dataDir: string;
  /** 附件目录，位于数据根目录下。 */
  readonly attachmentDir: string;
  /** 书籍源文件目录，位于数据根目录下。 */
  readonly booksDir: string;
  /** 资料库源文件目录，位于数据根目录下。 */
  readonly libraryDir: string;
  /** 后台任务的临时目录根，位于数据根目录下。 */
  readonly taskWorkDir: string;
  /** 主数据库文件。 */
  readonly databasePath: string;
}

/**
 * 由数据根目录派生出全部路径。
 *
 * @param dataDir 数据根目录，相对路径按当前工作目录解析
 * @returns 冻结的路径集合，进程内保持稳定
 */
export function createPaths(dataDir: string): Paths {
  const root = path.resolve(dataDir);
  return Object.freeze({
    dataDir: root,
    attachmentDir: path.join(root, 'attachment'),
    booksDir: path.join(root, 'books'),
    libraryDir: path.join(root, 'library'),
    taskWorkDir: path.join(root, 'task-work'),
    databasePath: path.join(root, 'easy-learn.db'),
  });
}
