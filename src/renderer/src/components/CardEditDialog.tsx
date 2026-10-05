import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/MarkdownEditor';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CardGroupSummary, CardRecord } from '@shared/types/flashcards';

/** 卡片编辑弹窗属性。 */
interface CardEditDialogProps {
  /** 被编辑的卡片；未提供时表示新增卡片。 */
  card?: CardRecord;
  /** 新增卡片时默认使用的牌组 ID。 */
  groupId?: string;
  /** 关闭弹窗回调。 */
  onOpenChange: (open: boolean) => void;
  /** 保存成功回调。 */
  onSaved: (card: CardRecord) => void;
}

/** 支持新增和编辑卡片的弹窗。 */
export function CardEditDialog({ card, groupId, onOpenChange, onSaved }: CardEditDialogProps) {
  const [groups, setGroups] = useState<CardGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(card?.groupId ?? groupId ?? '');
  const [front, setFront] = useState(card?.fields.front ?? '');
  const [back, setBack] = useState(card?.fields.back ?? '');
  const [tags, setTags] = useState(card?.tags.join(' ') ?? '');
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(card);

  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await window.api.listCardGroups();
        if (disposed) return;
        if (!result.success || !result.groups) {
          toast.error(result.error ?? '加载牌组失败');
          return;
        }

        setGroups(result.groups);
        setSelectedGroupId(current => current || groupId || result.groups?.[0]?.id || '');
      })();
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [groupId]);

  /** 保存新增或编辑后的卡片。 */
  async function handleSave() {
    if (!selectedGroupId) {
      toast.error('请先创建或选择一个牌组');
      return;
    }
    if (!front.trim() || !back.trim()) {
      toast.error('问题和答案都不能为空');
      return;
    }

    setSaving(true);
    const result = await window.api.saveCard({
      id: card?.id,
      groupId: selectedGroupId,
      type: card?.type ?? 'basic',
      fields: { front, back },
      tags: tags.split(/\s+/).filter(Boolean),
    });
    setSaving(false);

    if (!result.success || !result.card) {
      toast.error(result.error ?? '保存卡片失败');
      return;
    }

    toast.success(isEditing ? '卡片已保存' : '卡片已创建');
    window.dispatchEvent(new Event('flashcards:changed'));
    onSaved(result.card);

    if (isEditing) {
      onOpenChange(false);
      return;
    }

    // 新增模式保留弹窗并清空内容，便于连续添加多张卡片；牌组选择保留，方便继续添加到同一牌组
    setFront('');
    setBack('');
    setTags('');
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEditing ? '编辑卡片' : '新增卡片'}</DialogTitle>
          <DialogDescription>
            {isEditing ? '修改后保存，会立即更新当前内容。' : '填写问题和答案后创建卡片。'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <p className="text-sm font-medium">问题</p>
            <MarkdownEditor
              value={front}
              onChange={setFront}
              placeholder="输入问题或提示"
              className="focus-within:border-input focus-within:ring-0"
              minHeightClassName="min-h-28"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">答案</p>
            <MarkdownEditor
              value={back}
              onChange={setBack}
              placeholder="输入答案或解释"
              className="focus-within:border-input focus-within:ring-0"
              minHeightClassName="min-h-28"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">牌组</p>
            {groups.length ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">请先创建牌组</p>
            )}
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
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving || !groups.length} onClick={() => void handleSave()}>
            <Save />
            {saving ? '保存中…' : isEditing ? '保存' : '创建卡片'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
