import { useCallback, useEffect, useState, memo } from 'react';
import { BookOpen, Info, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { IconFileImport } from '@tabler/icons-react';
import { BookDetailDialog } from '@/components/BookDetailDialog';
import { useBooksStore } from '@/stores/books-store';
import { useTabsStore } from '@/stores/tabs-store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fallbackCoverText } from '@/utils/book-cover';
import type { BookDoc } from '@shared/types/books';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** 单本书卡片 */
function BookCard({
  book,
  deleting,
  onDelete,
  onOpenDetail,
  onClick,
}: {
  book: BookDoc;
  deleting: boolean;
  onDelete: (book: BookDoc) => void;
  onOpenDetail: (book: BookDoc) => void;
  onClick: () => void;
}) {
  const hasCover = !!book.coverUrl;
  return (
    <div
      className={cn(
        'group relative flex flex-col items-stretch text-left rounded-md overflow-hidden border border-border bg-card shadow-card hover:border-primary/40 hover:shadow-card-hover transition-all duration-200 hover:scale-105',
        deleting && 'pointer-events-none opacity-60'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={deleting}
        className="flex flex-col items-stretch text-left w-full cursor-pointer disabled:cursor-not-allowed"
      >
        {/* 封面区：纵横比 4:5 */}
        <div
          className={cn(
            'relative aspect-[4/5] w-full flex items-center justify-center overflow-hidden',
            hasCover ? 'bg-muted' : 'bg-gradient-to-br from-primary/15 to-primary/5'
          )}
        >
          {deleting ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : hasCover ? (
            <img
              src={book.coverUrl!}
              alt={book.booksName}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="px-2 text-center text-xs font-medium leading-snug break-all text-foreground/80 select-none">
              {fallbackCoverText(book.booksName)}
            </div>
          )}
        </div>
        {/* 标题区 */}
        <div className="px-2 py-1.5 flex flex-col gap-0.5 min-w-0">
          <div className="text-xs font-medium truncate">{book.booksName}</div>
          {book.author && (
            <div className="text-[10px] text-muted-foreground truncate">{book.author}</div>
          )}
        </div>
      </button>

      {/* 悬停才显示的右下角菜单按钮 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="书籍操作菜单"
            disabled={deleting}
            className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-full bg-background/80 backdrop-blur-sm border border-border/60 shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={4}>
          <DropdownMenuItem
            onSelect={() => {
              // 等 DropdownMenu 关闭动画完成再开 Dialog，
              // 避免两个 Radix Portal 的 FocusScope 共存造成焦点死锁。
              setTimeout(() => onOpenDetail(book), 200);
            }}
            className="cursor-pointer"
          >
            <Info className="h-4 w-4 mr-2" />
            详情
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              // 同上：等 DropdownMenu 关闭动画完成再开 AlertDialog。
              setTimeout(() => onDelete(book), 200);
            }}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            删除书籍
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** 导入按钮卡片（占网格第一个位置） */
function ImportCard({ importing, onClick }: { importing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={importing}
      className={cn(
        'group flex flex-col items-stretch text-left rounded-md overflow-hidden border border-dashed border-border bg-transparent shadow-card cursor-pointer',
        'hover:border-primary/50 hover:bg-primary/5 hover:shadow-card-hover transition-all duration-200 hover:scale-105',
        importing && 'cursor-not-allowed opacity-70'
      )}
    >
      <div className="aspect-[4/5] w-full flex flex-col items-center justify-center gap-2 text-muted-foreground group-hover:text-primary">
        {importing ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin" />
            <div className="text-xs">导入中...</div>
          </>
        ) : (
          <>
            <IconFileImport className="h-8 w-8" />
            <div className="text-xs">导入书籍</div>
          </>
        )}
      </div>
    </button>
  );
}

export const BookShelf = memo(function BookShelf() {
  const { books, importing, loaded, deletingId, loadBooks, importBook, deleteBook } =
    useBooksStore();
  const addTab = useTabsStore(s => s.addTab);
  const [pendingDelete, setPendingDelete] = useState<BookDoc | null>(null);
  // 详情弹窗以打开时的书籍快照为准：store 更新后不会打断弹窗里的输入
  const [detailBook, setDetailBook] = useState<BookDoc | null>(null);

  useEffect(() => {
    if (loaded) return;
    loadBooks().then(err => {
      if (err) toast.error(err);
    });
  }, [loaded, loadBooks]);

  /** 点击书籍卡片 → 新开一个 reader Tab（多实例，可同时打开多本） */
  const handleClickBook = (id: string) => {
    const book = books.find(b => b.id === id);
    if (!book) return;
    addTab('reader', { bookId: id, title: book.booksName });
  };

  /** 打开书籍详情弹窗 */
  const handleOpenDetail = (book: BookDoc) => {
    setDetailBook(book);
  };

  /** 打开删除确认弹窗 */
  const handleOpenDelete = (book: BookDoc) => {
    setPendingDelete(book);
  };

  /** 用户点击"取消" */
  const handleCancel = () => {
    setPendingDelete(null);
  };

  /** 用户点击"删除"，让 Radix Action 自动关闭弹窗并通知 onOpenChange */
  const handleConfirmDelete = () => {
    const book = pendingDelete;
    if (!book) return;
    deleteBook(book.id).then(err => {
      if (err) {
        toast.error(err);
      } else {
        toast.success(`《${book.booksName}》已删除`);
      }
    });
  };

  /** 导入书籍，失败时弹出错误提示 */
  const handleImport = useCallback(async () => {
    const err = await importBook();
    if (err) toast.error(err);
  }, [importBook]);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">书库</h2>
          {books.length > 0 && (
            <span className="text-xs text-muted-foreground">({books.length})</span>
          )}
        </div>
      </div>

      {/* 网格主体 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div
          className={cn(
            'grid gap-4',
            'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
          )}
        >
          <ImportCard importing={importing} onClick={handleImport} />
          {books.map(book => (
            <BookCard
              key={book.id}
              book={book}
              deleting={deletingId === book.id}
              onDelete={handleOpenDelete}
              onOpenDetail={handleOpenDetail}
              onClick={() => handleClickBook(book.id)}
            />
          ))}
        </div>

        {loaded && books.length === 0 && !importing && (
          <div className="mt-8 text-center text-sm text-muted-foreground">
            还没有导入任何书籍，点击上方卡片选择文件
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除书籍</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除《{pendingDelete?.booksName ?? ''}》？该操作无法恢复
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 书籍详情弹窗 */}
      {detailBook && (
        <BookDetailDialog
          key={detailBook.id}
          book={detailBook}
          onOpenChange={open => {
            if (!open) setDetailBook(null);
          }}
        />
      )}
    </div>
  );
});
