import { eq, desc } from 'drizzle-orm';
import { getDatabase } from '..';
import { bookTable } from '../schema';
import type { BookRow, InsertBookRow } from '../schema';

export class BookRepo {
  /** 创建书籍记录（不含封面字段） */
  create(data: InsertBookRow): BookRow {
    const db = getDatabase();
    const rows = db.insert(bookTable).values(data).returning().all();
    return rows[0];
  }

  /** 根据 ID 查询 */
  findById(id: string): BookRow | undefined {
    const db = getDatabase();
    return db.select().from(bookTable).where(eq(bookTable.id, id)).get();
  }

  /** 查询所有书籍，按创建时间倒序 */
  findAll(): BookRow[] {
    const db = getDatabase();
    return db.select().from(bookTable).orderBy(desc(bookTable.createdAt)).all();
  }

  /** 更新封面路径（导入流程分步写入时使用） */
  updateCoverImg(id: string, coverImg: string | null): void {
    const db = getDatabase();
    db.update(bookTable).set({ coverImg }).where(eq(bookTable.id, id)).run();
  }

  /** 更新界面上可编辑的元信息字段（书名 / 作者） */
  updateMeta(id: string, data: Pick<InsertBookRow, 'booksName' | 'author'>): void {
    const db = getDatabase();
    db.update(bookTable).set(data).where(eq(bookTable.id, id)).run();
  }

  /** 删除书籍 */
  delete(id: string): void {
    const db = getDatabase();
    db.delete(bookTable).where(eq(bookTable.id, id)).run();
  }
}

export const bookRepo = new BookRepo();
