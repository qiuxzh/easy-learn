import type { BookPageRepo as BookPageRepoContract } from '@main/contracts/book-repo';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { BookPageBlock } from '@shared/types/ocr';
import type { DbHandle } from '@main/infra/db/connection';
import { bookPageTable } from '@main/infra/db/schema';
import type { BookPageWrite } from '@main/contracts/book';
import type { BookPageRow } from '@main/infra/db/schema';

/** 单批写入的行数上限。一行 4 个字段，20 行远低于 SQLite 的参数上限。 */
const INSERT_BATCH_SIZE = 50;

/** 一页的识别结果：块已经解析过。 */
export interface BookPageContent {
  page: number;
  blocks: BookPageBlock[];
}

/**
 * OCR 逐页结果的数据访问。
 *
 * 没有状态列：行存在就是识别完成，空块表示空白页。
 * 这里的写操作只按书整体替换或按块追加，所以「页数」始终等于已识别的页数。
 *
 * 对外给的是解析后的块（`listBlocks` / `listPages`），列里存的是 JSON 这件事只留在这一层。
 */
class BookPageRepo {
  constructor(private readonly handle: DbHandle) {}

  /** 按页序读出整本书的识别结果，块已解析；供分片与附件清理使用。 */
  listBlocks(bookId: string): BookPageContent[] {
    return this.listRows(bookId).map(row => ({
      page: row.page,
      blocks: parseBlocks(row.blocks),
    }));
  }

  /** 原始行只在这里用；对外一律给解析后的块。 */
  private listRows(bookId: string): BookPageRow[] {
    return this.handle.db
      .select()
      .from(bookPageTable)
      .where(eq(bookPageTable.bookId, bookId))
      .orderBy(asc(bookPageTable.page))
      .all();
  }

  /** 按页号读取若干页的识别结果，块已解析；不存在的页不返回。 */
  listPages(bookId: string, pages: number[]): BookPageContent[] {
    if (pages.length === 0) return [];
    return this.handle.db
      .select()
      .from(bookPageTable)
      .where(and(eq(bookPageTable.bookId, bookId), inArray(bookPageTable.page, pages)))
      .orderBy(asc(bookPageTable.page))
      .all()
      .map(row => ({ page: row.page, blocks: parseBlocks(row.blocks) }));
  }

  /** 已识别的页号集合，用来跳过已经完成的块。 */
  listPageNumbers(bookId: string): Set<number> {
    return new Set(
      this.handle.db
        .select({ page: bookPageTable.page })
        .from(bookPageTable)
        .where(eq(bookPageTable.bookId, bookId))
        .all()
        .map(row => row.page)
    );
  }

  /** 已识别的页数。 */
  countPages(bookId: string): number {
    const row = this.handle.db
      .select({ count: count() })
      .from(bookPageTable)
      .where(eq(bookPageTable.bookId, bookId))
      .get();
    return row?.count ?? 0;
  }

  /** 批量写入一页的结果；同一个块的行会在一个事务里调用。 */
  insertMany(rows: readonly BookPageWrite[]): void {
    if (rows.length === 0) return;
    this.handle.transaction(() => {
      for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
        this.handle.db
          .insert(bookPageTable)
          .values(
            rows.slice(index, index + INSERT_BATCH_SIZE).map(row => ({
              bookId: row.bookId,
              page: row.page,
              blocks: JSON.stringify(row.blocks),
              updatedAt: row.updatedAt,
            }))
          )
          .run();
      }
    });
  }

  /**
   * 删掉一本书里指定页的结果。
   *
   * 重跑某一页时先删后写，保证「页」的写入是覆盖而不是叠加；
   * 块级事务里调用，失败时整块回滚。
   */
  deletePages(bookId: string, pages: number[]): void {
    if (pages.length === 0) return;
    this.handle.db
      .delete(bookPageTable)
      .where(and(eq(bookPageTable.bookId, bookId), inArray(bookPageTable.page, pages)))
      .run();
  }

  /** 清掉一本书的全部识别结果。重新提取与删除书籍时调用。 */
  deleteByBook(bookId: string): void {
    this.handle.db.delete(bookPageTable).where(eq(bookPageTable.bookId, bookId)).run();
  }
}

/** 读页面块 JSON；内容损坏时按空页处理，不让一页拖垮整本书。 */
function parseBlocks(raw: string): BookPageBlock[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BookPageBlock[]) : [];
  } catch {
    return [];
  }
}

/** 实现类不导出，调用方只依赖 contracts 里的接口。 */
export function createBookPageRepo(handle: DbHandle): BookPageRepoContract {
  return new BookPageRepo(handle);
}
