import { useEffect, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BookIndexSection } from '@/components/BookIndexSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useBooksStore } from '@/stores/books-store';
import { coverMimeType, fallbackCoverText } from '@/utils/book-cover';
import { formatDateTime } from '@shared/utils/time-util';
import type { BookDoc, BookUpdateRequest, CoverImage } from '@shared/types/books';

/** 换封面时的本地预览：Blob URL 用于显示，cover 是等待随保存一起落盘的图片内容 */
interface CoverPreview {
  url: string;
  cover: CoverImage;
}

/** 书籍详情弹窗属性 */
interface BookDetailDialogProps {
  /** 要查看 / 编辑的书籍 */
  book: BookDoc;
  /** 关闭弹窗回调 */
  onOpenChange: (open: boolean) => void;
}

/** 把字节数格式化为便于阅读的大小，未知大小显示为"—" */
function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 详情里的一项只读信息 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * 书籍详情弹窗：展示书名、封面、作者、大小等信息，并支持修改书名、作者与封面。
 * 书名和作者改完点"保存"一起写入；封面选好后先本地预览，同样在保存时才落盘。
 */
export function BookDetailDialog({ book, onOpenChange }: BookDetailDialogProps) {
  const updateBook = useBooksStore(state => state.updateBook);
  const [booksName, setBooksName] = useState(book.booksName);
  const [author, setAuthor] = useState(book.author ?? '');
  const [preview, setPreview] = useState<CoverPreview | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [saving, setSaving] = useState(false);

  // 预览图被替换或弹窗关闭时回收 Blob URL，避免占着内存不放
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  /** 弹文件框选一张新封面，选好后只做本地预览 */
  async function handlePickCover() {
    const res = await window.api.pickBookCover();
    if (res.canceled) return;
    if (!res.success || !res.cover) {
      toast.error(res.error ?? '选择封面失败');
      return;
    }

    const cover = res.cover;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(cover.bytes)], { type: coverMimeType(cover.ext) })
    );
    setPreview({ url, cover });
    setCoverRemoved(false);
  }

  /** 移除当前封面（本地生效，保存后才真正删除文件） */
  function handleRemoveCover() {
    setPreview(null);
    setCoverRemoved(true);
  }

  /** 保存书名、作者与封面 */
  async function handleSave() {
    const trimmedName = booksName.trim();
    if (!trimmedName) {
      toast.error('书名不能为空');
      return;
    }

    const patch: Omit<BookUpdateRequest, 'id'> = {
      booksName: trimmedName,
      author: author.trim(),
    };
    if (preview) {
      patch.cover = preview.cover;
    } else if (coverRemoved) {
      patch.cover = null;
    }

    setSaving(true);
    const err = await updateBook(book.id, patch);
    setSaving(false);

    if (err) {
      toast.error(err);
      return;
    }

    toast.success('书籍信息已保存');
    onOpenChange(false);
  }

  // 待保存的封面优先于数据库里的封面，其次是用户刚移除封面的状态
  const coverSrc = preview ? preview.url : coverRemoved ? null : book.coverUrl;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>书籍详情</DialogTitle>
          <DialogDescription>可以修改书名、作者和封面，保存后立即生效。</DialogDescription>
        </DialogHeader>

        <div className="flex gap-5">
          {/* 封面区：点击更换，悬停显示提示 */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePickCover()}
              aria-label="更换封面"
              className="group relative flex aspect-[4/5] w-32 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-center cursor-pointer"
            >
              {coverSrc ? (
                <img src={coverSrc} alt={booksName} className="h-full w-full object-cover" />
              ) : (
                <span className="px-2 text-xs font-medium leading-snug break-all text-foreground/80 select-none">
                  {fallbackCoverText(booksName)}
                </span>
              )}
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                <ImageUp className="h-5 w-5" />
                更换封面
              </span>
            </button>
            {(book.coverUrl || preview) && !coverRemoved && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={handleRemoveCover}
              >
                <Trash2 />
                移除封面
              </Button>
            )}
          </div>

          {/* 表单区 */}
          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">书名</p>
              <Input
                value={booksName}
                onChange={event => setBooksName(event.target.value)}
                placeholder="请输入书名"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">作者</p>
              <Input
                value={author}
                onChange={event => setAuthor(event.target.value)}
                placeholder="未知作者"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">信息</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs">
                <InfoRow label="格式" value={book.booksType.toUpperCase()} />
                <InfoRow label="大小" value={formatFileSize(book.fileSize)} />
                <InfoRow
                  label="章节数"
                  value={book.totalChapters === null ? '—' : String(book.totalChapters)}
                />
                <InfoRow
                  label="总页数"
                  value={book.totalPages === null ? '—' : String(book.totalPages)}
                />
                <InfoRow label="导入时间" value={formatDateTime(book.createdAt)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">简介</p>
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {book.description?.trim() || '暂无简介'}
              </p>
            </div>
          </div>
        </div>

        <BookIndexSection bookId={book.id} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
