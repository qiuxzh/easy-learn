import { useCallback, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { CardEditDialog } from '@/components/CardEditDialog';
import type { CardRecord } from '@shared/types/flashcards';

/** 弹窗当前的编辑目标：新增时记录牌组，编辑时记录卡片。 */
type CardEditTarget = { mode: 'create'; groupId: string } | { mode: 'edit'; card: CardRecord };

/** useCardEditDialog 的可选配置。 */
interface UseCardEditDialogOptions {
  /** 卡片保存成功后的回调，用于刷新列表、重置分页等副作用。 */
  onSaved?: (card: CardRecord) => void;
}

/** useCardEditDialog 返回的操作与弹窗节点。 */
interface UseCardEditDialogResult {
  /** 打开新增卡片弹窗；未指定牌组时提示错误并保持关闭。 */
  openCreateCard: (groupId?: string) => void;
  /** 打开编辑卡片弹窗。 */
  openEditCard: (card: CardRecord) => void;
  /** 关闭卡片弹窗。 */
  closeCardDialog: () => void;
  /** 需要渲染进组件树的弹窗节点；未打开时为 null。 */
  cardEditDialog: ReactElement | null;
}

/**
 * useCardEditDialog：集中管理卡片新增/编辑弹窗的状态与渲染。
 * 调用方只需把 cardEditDialog 渲染到组件树中，再通过 openCreateCard / openEditCard 打开弹窗，
 * 弹窗的关闭与保存副作用都由本 Hook 统一处理。
 */
export function useCardEditDialog({
  onSaved,
}: UseCardEditDialogOptions = {}): UseCardEditDialogResult {
  /** 弹窗当前的编辑目标；为 null 表示弹窗关闭。 */
  const [target, setTarget] = useState<CardEditTarget | null>(null);

  /** 打开新增卡片弹窗。 */
  const openCreateCard = useCallback((groupId?: string) => {
    if (!groupId) {
      toast.error('请先创建牌组');
      return;
    }
    setTarget({ mode: 'create', groupId });
  }, []);

  /** 打开编辑卡片弹窗。 */
  const openEditCard = useCallback((card: CardRecord) => {
    setTarget({ mode: 'edit', card });
  }, []);

  /** 关闭卡片弹窗。 */
  const closeCardDialog = useCallback(() => {
    setTarget(null);
  }, []);

  /** 保存成功后：编辑模式关闭弹窗，新增模式保留弹窗以便连续添加。 */
  const handleSaved = useCallback(
    (card: CardRecord) => {
      setTarget(current => (current?.mode === 'edit' ? null : current));
      onSaved?.(card);
    },
    [onSaved]
  );

  // key 随编辑目标变化，保证切换目标时弹窗内的表单重新初始化
  const cardEditDialog = target ? (
    <CardEditDialog
      key={target.mode === 'edit' ? `edit-${target.card.id}` : `create-${target.groupId}`}
      card={target.mode === 'edit' ? target.card : undefined}
      groupId={target.mode === 'create' ? target.groupId : undefined}
      onOpenChange={open => {
        if (!open) closeCardDialog();
      }}
      onSaved={handleSaved}
    />
  ) : null;

  return { openCreateCard, openEditCard, closeCardDialog, cardEditDialog };
}
