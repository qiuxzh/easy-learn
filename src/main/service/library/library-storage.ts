import fs from 'node:fs';
import path from 'node:path';
import type { ResourceFormat } from '@shared/types/library';
import type { Paths } from '@main/paths';
import { isInsideDir, toPosixRelative } from '@main/utils/attachment-util';

/**
 * 资料库源文件的存储接口，便于用例层注入替身。
 */
export interface LibraryFileStore {
  /** 把源文件复制进资料库，返回相对 data 目录的路径与字节数。 */
  importFile(
    sourcePath: string,
    resourceId: string,
    format: ResourceFormat
  ): { blobPath: string; sizeBytes: number };

  /** 删除若干库内文件；越界路径直接拒绝，单个失败只记日志。 */
  removeBlobs(blobPaths: readonly (string | null)[]): void;
}

/**
 * 资料库源文件的落盘与删除。
 *
 * 库内文件以不可变 id 命名，重命名与移动只改数据库，不搬动磁盘文件。
 */
export class LibraryStorage implements LibraryFileStore {
  private readonly dataDir: string;
  private readonly libraryDir: string;

  constructor(paths: Paths) {
    this.dataDir = paths.dataDir;
    this.libraryDir = paths.libraryDir;
  }

  /**
   * 把源文件复制进资料库，返回相对 data 目录的路径与字节数。
   *
   * @throws 复制或读取文件大小失败
   */
  importFile(
    sourcePath: string,
    resourceId: string,
    format: ResourceFormat
  ): { blobPath: string; sizeBytes: number } {
    fs.mkdirSync(this.libraryDir, { recursive: true });
    const target = path.join(this.libraryDir, `${resourceId}.${format}`);
    fs.copyFileSync(sourcePath, target);
    return {
      blobPath: toPosixRelative(this.dataDir, target),
      sizeBytes: fs.statSync(target).size,
    };
  }

  /**
   * 删除若干库内文件。
   *
   * 越界路径直接拒绝，单个删除失败只记日志：记录已经删除时，残留文件不应阻断调用方。
   */
  removeBlobs(blobPaths: readonly (string | null)[]): void {
    for (const blobPath of blobPaths) {
      if (!blobPath) continue;
      const target = this.resolve(blobPath);
      if (!target) {
        console.warn('[LibraryStorage] blocked removing path outside library:', blobPath);
        continue;
      }
      try {
        fs.rmSync(target, { force: true });
      } catch (e) {
        console.warn('[LibraryStorage] remove blob failed:', target, e);
      }
    }
  }

  /** 把库内相对路径解析为绝对路径；越界时返回 null。 */
  private resolve(blobPath: string): string | null {
    const target = path.resolve(this.dataDir, blobPath);
    return isInsideDir(this.libraryDir, target) ? target : null;
  }
}
