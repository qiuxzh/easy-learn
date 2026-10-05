import { useEffect, useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/MarkdownEditor';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CardGroupSummary, CardRecord } from '@shared/types/flashcards';

/** 内嵌卡片编辑栏属性。 */
interface CardEditorProps {
  /** 当前编辑的卡片。 */
  card: CardRecord;
  /** 关闭编辑栏。 */
  onClose: () => void;
  /** 保存成功回调。 */
  onSaved: (card: CardRecord) => void;
  /** 删除成功回调。 */
  onDeleted: () => void;
}

/** 闪卡浏览页右侧的内嵌卡片编辑栏。 */
export function CardEditor({ card, onClose, onSaved, onDeleted }: CardEditorProps) {
  const [groups, setGroups] = useState<CardGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(card.groupId);
  const [front, setFront] = useState(card.fields.front);
  const [back, setBack] = useState(card.fields.back);
  const [tags, setTags] = useState(card.tags.join(' '));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await window.api.listCardGroups();
        if (disposed) return;
        if (!result.success || !result.groups) {
          toast.error(result.error ?? '加载牌组失败');
          setLoading(false);
          return;
        }

        setGroups(result.groups);
        setSelectedGroupId(current => current || result.groups?.[0]?.id || '');
        setLoading(false);
      })();
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  /** 保存编辑后的卡片。 */
  async function handleSave() {
    if (!selectedGroupId) {
      toast.error('请先选择牌组');
      return;
    }
    if (!front.trim() || !back.trim()) {
      toast.error('问题和答案都不能为空');
      return;
    }

    setSaving(true);
    const result = await window.api.saveCard({
      id: card.id,
      groupId: selectedGroupId,
      type: card.type,
      fields: { front, back },
      tags: tags.split(/\s+/).filter(Boolean),
    });
    setSaving(false);

    if (!result.success || !result.card) {
      toast.error(result.error ?? '保存卡片失败');
      return;
    }

    toast.success('卡片已保存');
    window.dispatchEvent(new Event('flashcards:changed'));
    onSaved(result.card);
  }

  /** 删除当前编辑的卡片。 */
  async function handleDelete() {
    const result = await window.api.deleteCard({ id: card.id });
    if (!result.success) {
      toast.error(result.error ?? '删除卡片失败');
      return;
    }

    setDeleteOpen(false);
    window.dispatchEvent(new Event('flashcards:changed'));
    toast.success('卡片已删除');
    onDeleted();
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载牌组…
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="text-base font-semibold">编辑卡片</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除卡片"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
          </Button>
          <Button variant="ghost" size="icon" aria-label="关闭编辑栏" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">问题</p>
          <MarkdownEditor
            value={front}
            onChange={setFront}
            placeholder="输入问题或提示"
            className="focus-within:border-input focus-within:ring-0"
            minHeightClassName="min-h-40"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">答案</p>
          <MarkdownEditor
            value={back}
            onChange={setBack}
            placeholder="输入答案或解释"
            className="focus-within:border-input focus-within:ring-0"
            minHeightClassName="min-h-40"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">牌组</p>
          <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
            <SelectTrigger className="w-full focus-visible:ring-0 focus-visible:ring-offset-0">
              <SelectValue placeholder="请选择牌组" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="start"
              className="z-popover w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
            >
              {groups.map(group => (
                <SelectItem key={group.id} value={group.id} className="cursor-pointer">
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">标签</p>
          <Input
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="使用空格分隔多个标签"
            className="focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t px-5 py-4">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button disabled={saving} onClick={() => void handleSave()}>
          <Save />
          {saving ? '保存中…' : '保存修改'}
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除卡片</AlertDialogTitle>
            <AlertDialogDescription>确定删除这张卡片吗？删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">取消</AlertDialogCancel>
            <AlertDialogAction className="cursor-pointer" onClick={() => void handleDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
