import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, ScanText, Square, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useLibraryStore } from '@/stores/library-store';
import { useTaskStore } from '@/stores/task-store';
import {
  describeOcrTaskFailure,
  findOcrTask,
  ocrStatusLabel,
  ocrStatusTone,
  resolveOcrProgress,
  resolveOcrStatus,
} from '@/utils/library-ocr';
import { FORMAT_LABEL, formatBytes, formatDate } from '@/utils/library-format';
import type { ResourceDTO } from '@shared/types/library';
import type { TaskOpResult } from '@shared/types/task';

/** 待确认的破坏性操作。 */
type PendingConfirm = 'restart';

/**
 * 资料详情栏：属性、OCR 状态与操作。
 *
 * 任务状态读 task-store，页数与分片读 library-store，组件里按资源 id 合并。
 */
export function ResourceDetailDrawer({
  resource,
  onClose,
}: {
  resource: ResourceDTO;
  onClose: () => void;
}) {
  const task = useTaskStore(state => findOcrTask(state.tasks, resource.id));
  const ocrState = useLibraryStore(state => state.ocrStates[resource.id]);
  const ocrLoading = useLibraryStore(state => state.ocrLoading[resource.id]);
  const ocrError = useLibraryStore(state => state.ocrErrors[resource.id]);

  const loadOcrState = useLibraryStore(state => state.loadOcrState);
  const startOcr = useLibraryStore(state => state.startOcr);
  const pauseTask = useTaskStore(state => state.pause);
  const resumeTask = useTaskStore(state => state.resume);
  const cancelTask = useTaskStore(state => state.cancel);
  const retryTask = useTaskStore(state => state.retry);

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const previousTaskId = useRef<string | null>(null);

  const isPdf = resource.kind === 'file' && resource.format === 'pdf';
  const status = resolveOcrStatus(task, ocrState);
  const progress = resolveOcrProgress(task, ocrState);
  const label = ocrStatusLabel(status, progress);
  const tone = ocrStatusTone(status);
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  const pageLine = progress ? `${progress.finished} / ${progress.total} 页` : '—';

  useEffect(() => {
    void loadOcrState(resource.id);
  }, [resource.id, loadOcrState]);

  // 任务结束（成功、失败、取消）后重新读一次域状态，更新页数与分片数。
  useEffect(() => {
    const current = task?.id ?? null;
    if (previousTaskId.current && current === null) void loadOcrState(resource.id);
    previousTaskId.current = current;
  }, [task, resource.id, loadOcrState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function runTask(operation: () => Promise<TaskOpResult>, success: string): Promise<void> {
    setBusy(true);
    try {
      const result = await operation();
      if (result.ok) toast.success(success);
      else toast.error(describeOcrTaskFailure(result.reason));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleStart(restart: boolean): Promise<void> {
    setBusy(true);
    try {
      await startOcr(resource.id, restart);
      toast.success(restart ? '已重新开始识别' : '已开始识别');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleConfirm(): void {
    setConfirm(null);
    void handleStart(true);
  }

  function renderActions() {
    if (!isPdf) return null;

    if (!task) {
      return (
        <div className="flex flex-wrap gap-2">
          {status !== 'completed' && ocrState && ocrState.donePages > 0 && (
            <Button
              variant="solid"
              size="sm"
              disabled={busy}
              onClick={() => void handleStart(false)}
            >
              <Play />
              继续识别
            </Button>
          )}
          {ocrState?.donePages ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm('restart')}
            >
              <RotateCcw />
              重新识别
            </Button>
          ) : (
            <Button
              variant="solid"
              size="sm"
              disabled={busy || ocrLoading}
              onClick={() => void handleStart(false)}
            >
              <ScanText />
              开始识别
            </Button>
          )}
        </div>
      );
    }

    if (task.status === 'running') {
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runTask(() => pauseTask(task.id), '已暂停')}
          >
            <Pause />
            暂停
          </Button>
          <Button
            variant="outline"
            size="sm"
            tone="danger"
            disabled={busy}
            onClick={() => void runTask(() => cancelTask(task.id), '已取消识别')}
          >
            <Square />
            取消
          </Button>
        </div>
      );
    }

    if (task.status === 'paused') {
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="solid"
            size="sm"
            disabled={busy}
            onClick={() => void runTask(() => resumeTask(task.id), '已继续')}
          >
            <Play />
            继续
          </Button>
          <Button
            variant="outline"
            size="sm"
            tone="danger"
            disabled={busy}
            onClick={() => void runTask(() => cancelTask(task.id), '已取消识别')}
          >
            <Square />
            取消
          </Button>
        </div>
      );
    }

    if (task.status === 'queued') {
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            tone="danger"
            disabled={busy}
            onClick={() => void runTask(() => cancelTask(task.id), '已取消识别')}
          >
            <Square />
            取消
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="solid"
          size="sm"
          disabled={busy}
          onClick={() => void runTask(() => retryTask(task.id), '已重新排队')}
        >
          <RotateCcw />
          重试
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm('restart')}>
          <RotateCcw />
          重新识别
        </Button>
      </div>
    );
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-stroke-3 bg-card shadow-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke-3 px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{resource.name}</span>
        <IconButton label="关闭" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <dl className="grid grid-cols-[56px_1fr] gap-x-2 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">格式</dt>
          <dd>{resource.format ? FORMAT_LABEL[resource.format] : '—'}</dd>
          <dt className="text-muted-foreground">大小</dt>
          <dd>{formatBytes(resource.sizeBytes)}</dd>
          <dt className="text-muted-foreground">导入时间</dt>
          <dd>{formatDate(resource.createdAt)}</dd>
          <dt className="text-muted-foreground">页数</dt>
          <dd>{ocrState?.pageCount ?? '—'}</dd>
        </dl>

        {isPdf && ocrState?.hasTextLayer === false && (
          <div className="mt-3 flex gap-2 rounded-md border border-warn-border bg-warn-surface px-2.5 py-2 text-xs leading-5 text-warn-ink">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>本资料可能是 PDF 扫描件，没有文本层，建议进行文字识别。</span>
          </div>
        )}

        <div className="mt-4 border-t border-stroke-3 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">文字识别</span>
            {isPdf && (
              <Badge variant="outline" tone={tone}>
                {label}
              </Badge>
            )}
          </div>

          {!isPdf ? (
            <p className="mt-2 text-xs text-muted-foreground">该格式不需要识别。</p>
          ) : (
            <>
              {progress && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>{pageLine}</span>
                    <span>{percent}%</span>
                  </div>
                </>
              )}

              {ocrLoading && !ocrState && (
                <p className="mt-2 text-xs text-muted-foreground">正在读取状态…</p>
              )}
              {ocrError && <p className="mt-2 text-xs text-destructive">{ocrError}</p>}
              {task?.error && <p className="mt-2 text-xs text-destructive">{task.error.message}</p>}

              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {ocrState?.hasTextLayer
                  ? '该 PDF 有文本层，仍可重新识别。'
                  : status === 'idle'
                    ? '识别后可分片检索。'
                    : status === 'partial'
                      ? '识别已中断，已完成的页会保留；继续识别会从剩下的页开始。'
                      : status === 'completed'
                        ? `识别完成，已生成 ${ocrState?.chunkCount ?? 0} 个分片。`
                        : '已识别的页会保留；关闭右侧栏不会中断任务。'}
              </p>

              <div className="mt-3">{renderActions()}</div>
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={open => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={event => event.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>重新识别这个文件？</AlertDialogTitle>
            <AlertDialogDescription>
              已识别的页块和分片会被清空，然后从头重新识别。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
