import type { BookRepo as BookRepoContract } from '@main/contracts/book-repo';
import type { BookEntity, BookCreate } from '@main/contracts/book';
import { eq, desc } from 'drizzle-orm';
import type { DbHandle } from '@main/infra/db/connection';
import { bookTable } from '@main/infra/db/schema';
import type { BookRow } from '@main/infra/db/schema';

class BookRepo {
  constructor(private readonly handle: DbHandle) {}

  /** 创建书籍记录（不含封面字段）。 */
  create(data: BookCreate): BookEntity {
    const rows = this.handle.db
      .insert(bookTable)
      .values({
        id: data.id,
        booksName: data.booksName,
        booksStoreName: data.booksStoreName,
        booksType: data.booksType,
        coverAttachment: data.coverAttachment,
        totalPages: data.totalPages,
        totalChapters: data.totalChapters,
        description: data.description,
        author: data.author,
        createdAt: data.createdAt,
      })
      .returning()
      .all();
    return toBookEntity(rows[0]);
  }

  /** 根据 ID 查询。 */
  findById(id: string): BookEntity | undefined {
    const row = this.handle.db.select().from(bookTable).where(eq(bookTable.id, id)).get();
    return row ? toBookEntity(row) : undefined;
  }

  /** 查询所有书籍，按创建时间倒序。 */
  findAll(): BookEntity[] {
    return this.handle.db
      .select()
      .from(bookTable)
      .orderBy(desc(bookTable.createdAt))
      .all()
      .map(toBookEntity);
  }

  /** 读取书籍源文件的落盘文件名；书不存在时返回 null。 */
  findStoreName(id: string): string | null {
    const row = this.handle.db
      .select({ booksStoreName: bookTable.booksStoreName })
      .from(bookTable)
      .where(eq(bookTable.id, id))
      .get();
    return row?.booksStoreName ?? null;
  }

  /** 更新封面附件 id（导入流程分步写入时使用）。 */
  updateCoverAttachment(id: string, coverAttachment: string | null): void {
    this.handle.db.update(bookTable).set({ coverAttachment }).where(eq(bookTable.id, id)).run();
  }

  /** 更新界面上可编辑的元信息字段（书名 / 作者）。 */
  updateMeta(id: string, data: Pick<BookEntity, 'booksName' | 'author'>): void {
    this.handle.db.update(bookTable).set(data).where(eq(bookTable.id, id)).run();
  }

  /** 删除书籍。 */
  delete(id: string): void {
    this.handle.db.delete(bookTable).where(eq(bookTable.id, id)).run();
  }
}

/**
 * 行转书籍实体：落盘文件名不属于书籍，只通过 `findStoreName` 暴露。
 *
 * @param row 数据库行
 */
function toBookEntity(row: BookRow): BookEntity {
  return {
    id: row.id,
    booksName: row.booksName,
    booksType: row.booksType,
    coverAttachment: row.coverAttachment,
    totalPages: row.totalPages,
    totalChapters: row.totalChapters,
    description: row.description,
    author: row.author,
    createdAt: row.createdAt,
  };
}

/** 实现类不导出，调用方只依赖 contracts 里的接口。 */
export function createBookRepo(handle: DbHandle): BookRepoContract {
  return new BookRepo(handle);
}
