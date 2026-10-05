import { create } from 'zustand';
import type { BookDoc } from '@shared/types/books';

interface BooksState {
  books: BookDoc[];
  importing: boolean;
  loaded: boolean;
  deletingId: string | null;

  loadBooks: () => Promise<string | null>;
  importBook: () => Promise<string | null>;
  deleteBook: (id: string) => Promise<string | null>;
}

export const useBooksStore = create<BooksState>((set, get) => ({
  books: [],
  importing: false,
  loaded: false,
  deletingId: null,

  loadBooks: async () => {
    const res = await window.api.getAllBooks();
    if (res.success && res.books) {
      set({ books: res.books, loaded: true });
      return null;
    }
    set({ loaded: true });
    return res.error ?? '加载书籍失败';
  },

  importBook: async () => {
    if (get().importing) return null;
    set({ importing: true });

    try {
      // main 端负责 dialog 选文件 + 解析 + 写库，renderer 只等结果
      const res = await window.api.pickAndImportBook();
      if (res.canceled) {
        set({ importing: false });
        return null;
      }
      if (!res.success) {
        throw new Error(res.error ?? '导入失败');
      }

      await get().loadBooks();
      set({ importing: false });
      return null;
    } catch (e) {
      set({ importing: false });
      return String(e);
    }
  },

  deleteBook: async (id: string) => {
    if (get().deletingId) return null;
    set({ deletingId: id });

    try {
      const res = await window.api.deleteBook(id);
      if (!res.success) {
        throw new Error(res.error ?? '删除失败');
      }
      set(state => ({
        books: state.books.filter(b => b.id !== id),
        deletingId: null,
      }));
      return null;
    } catch (e) {
      set({ deletingId: null });
      return String(e);
    }
  },
}));
