import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  Filter,
  FolderInput,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
  Square,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { LIBRARY_ROOT_KEY, useLibraryStore } from '@/stores/library-store';
import { useTabsStore } from '@/stores/tabs-store';
import { useTaskStore } from '@/stores/task-store';
import { ResourceDetailDrawer } from '@/components/ResourceDetailDrawer';
import { ResourceIcon } from '@/components/ResourceIcon';
import { FORMAT_LABEL, formatBytes, formatDate } from '@/utils/library-format';
import {
  collectOcrTasks,
  describeOcrTaskFailure,
  ocrStatusLabel,
  ocrStatusTone,
  resolveOcrProgress,
  resolveOcrStatus,
} from '@/utils/library-ocr';
import type { ResourceDTO, ResourceFormat, ResourceSort } from '@shared/types/library';
import type { TaskOpResult } from '@shared/types/task';

/** 工具栏排序项的展示名。 */
const SORT_LABEL: Record<ResourceSort, string> = {
  name: '名称',
  size: '大小',
  updatedAt: '修改时间',
};

/** 类型过滤选项；all 表示不过滤。 */
const FILTER_OPTIONS: Array<{ value: 'all' | ResourceFormat; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'pdf', label: 'PDF' },
  { value: 'epub', label: 'EPUB' },
  { value: 'md', label: 'MD' },
  { value: 'txt', label: 'TXT' },
];

/** 当前打开的对话框。 */
type ActiveDialog =
  | { kind: 'create' }
  | { kind: 'rename'; item: ResourceDTO }
  | { kind: 'move'; item: ResourceDTO }
  | null;

/** 一个可展开的目录选项节点。 */
function PickerFolder({
  folder,
  depth,
  value,
  onChange,
}: {
  folder: ResourceDTO;
  depth: number;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const children = useLibraryStore(s => s.childrenCache[folder.id]);
  const loadChildren = useLibraryStore(s => s.loadChildren);
  const [open, setOpen] = useState(false);
  const subFolders = (children ?? []).filter(item => item.kind === 'folder');

  function toggle(): void {
    if (!open && !children) void loadChildren(folder.id);
    setOpen(value => !value);
  }

  return (
    <div>
      <PickerRow
        id={folder.id}
        name={folder.name}
        depth={depth}
        value={value}
        onChange={onChange}
        expanded={open}
        onToggle={toggle}
      />
      {open &&
        subFolders.map(child => (
          <PickerFolder
            key={child.id}
            folder={child}
            depth={depth + 1}
            value={value}
            onChange={onChange}
          />
        ))}
    </div>
  );
}

/** 目录选择的一行。 */
function PickerRow({
  id,
  name,
  depth,
  value,
  onChange,
  expanded,
  onToggle,
}: {
  id: string | null;
  name: string;
  depth: number;
  value: string | null;
  onChange: (id: string | null) => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex h-8 items-center gap-1 rounded-md px-1 hover:bg-secondary">
      <button
        type="button"
        aria-label={expanded ? '收起目录' : '展开目录'}
        className={cn(
          'flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground',
          !onToggle && 'invisible'
        )}
        onClick={onToggle}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        style={{ paddingLeft: depth * 10 }}
        onClick={() => onChange(id)}
      >
        {value === id ? (
          <Check className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <ResourceIcon kind="folder" size="sm" className="shrink-0" />
        <span className="truncate">{name}</span>
      </button>
    </div>
  );
}

/** 移动到对话框里的目录树。 */
function FolderPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const rootChildren = useLibraryStore(s => s.childrenCache[LIBRARY_ROOT_KEY]);
  const rootFolders = (rootChildren ?? []).filter(item => item.kind === 'folder');
  const loadChildren = useLibraryStore(s => s.loadChildren);

  useEffect(() => {
    void loadChildren(null);
  }, [loadChildren]);

  return (
    <div className="max-h-56 overflow-auto rounded-md border border-stroke-3 p-1">
      <PickerRow id={null} name="资料库" depth={0} value={value} onChange={onChange} />
      {rootFolders.map(folder => (
        <PickerFolder key={folder.id} folder={folder} depth={1} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

/**
 * 资料库主区：工具栏、文件夹行、文件网格与详情视图，以及重命名/移动/删除对话框。
 */
export function LibraryBrowser() {
  const path = useLibraryStore(s => s.path);
  const items = useLibraryStore(s => s.items);
  const viewMode = useLibraryStore(s => s.viewMode);
  const sort = useLibraryStore(s => s.sort);
  const direction = useLibraryStore(s => s.direction);
  const formats = useLibraryStore(s => s.formats);
  const selectedIds = useLibraryStore(s => s.selectedIds);
  const loading = useLibraryStore(s => s.loading);
  const error = useLibraryStore(s => s.error);
  const importing = useLibraryStore(s => s.importing);

  const load = useLibraryStore(s => s.load);
  const openFolder = useLibraryStore(s => s.openFolder);
  const setSort = useLibraryStore(s => s.setSort);
  const setFormats = useLibraryStore(s => s.setFormats);
  const setViewMode = useLibraryStore(s => s.setViewMode);
  const select = useLibraryStore(s => s.select);
  const importFiles = useLibraryStore(s => s.importFiles);
  const createFolder = useLibraryStore(s => s.createFolder);
  const renameResource = useLibraryStore(s => s.renameResource);
  const reparentResource = useLibraryStore(s => s.reparentResource);
  const deleteFile = useLibraryStore(s => s.deleteFile);
  const deleteFolderRecursive = useLibraryStore(s => s.deleteFolderRecursive);
  const setStarred = useLibraryStore(s => s.setStarred);
  const startOcr = useLibraryStore(s => s.startOcr);
  const loadOcrStates = useLibraryStore(s => s.loadOcrStates);
  const ocrStates = useLibraryStore(s => s.ocrStates);
  const tasks = useTaskStore(s => s.tasks);

  const ocrTasks = useMemo(() => collectOcrTasks(tasks), [tasks]);
  const pdfIds = useMemo(
    () => items.filter(item => item.kind === 'file' && item.format === 'pdf').map(item => item.id),
    [items]
  );
  const selectedFile = useMemo(
    () => items.find(item => item.kind === 'file' && selectedIds.includes(item.id)) ?? null,
    [items, selectedIds]
  );

  useEffect(() => {
    if (pdfIds.length > 0) void loadOcrStates(pdfIds);
  }, [pdfIds, loadOcrStates]);

  const previousOcrTaskIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(tasks.filter(task => task.taskType === 'ocr-pdf').map(task => task.id));
    const hasSettled = [...previousOcrTaskIds.current].some(id => !current.has(id));
    previousOcrTaskIds.current = current;
    if (hasSettled && pdfIds.length > 0) void loadOcrStates(pdfIds);
  }, [tasks, pdfIds, loadOcrStates]);

  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResourceDTO | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeFilter = formats[0] ?? 'all';
  const breadcrumb = path;

  function openRename(item: ResourceDTO): void {
    setDraftName(item.name);
    setDialog({ kind: 'rename', item });
    setDialogOpen(true);
  }

  function openMove(item: ResourceDTO): void {
    setMoveTarget(item.parentId);
    setDialog({ kind: 'move', item });
    setDialogOpen(true);
  }

  function openDelete(item: ResourceDTO): void {
    setDeleteTarget(item);
    setDeleteOpen(true);
  }

  function openCreate(): void {
    setDraftName('');
    setDialog({ kind: 'create' });
    setDialogOpen(true);
  }

  async function handleCreate(): Promise<void> {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    const message = await createFolder(name);
    setBusy(false);
    if (message) toast.error(message);
    else {
      toast.success('已新建文件夹');
      setDialogOpen(false);
    }
  }

  async function handleRename(): Promise<void> {
    if (!dialog || dialog.kind !== 'rename') return;
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    const message = await renameResource(dialog.item.id, name);
    setBusy(false);
    if (message) toast.error(message);
    else {
      setDialogOpen(false);
    }
  }

  async function handleMove(): Promise<void> {
    if (!dialog || dialog.kind !== 'move') return;
    setBusy(true);
    const message = await reparentResource(dialog.item.id, moveTarget);
    setBusy(false);
    if (message) toast.error(message);
    else {
      toast.success('已移动');
      setDialogOpen(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    setBusy(true);
    const message =
      deleteTarget.kind === 'folder'
        ? await deleteFolderRecursive(deleteTarget.id)
        : await deleteFile(deleteTarget.id);
    setBusy(false);
    if (message) toast.error(message);
    else {
      toast.success('已删除');
      setDeleteOpen(false);
    }
  }

  async function handleImport(): Promise<void> {
    const message = await importFiles();
    if (message) {
      toast.error(message);
      return;
    }
    const result = useLibraryStore.getState().lastImport;
    if (!result || result.canceled) return;
    if (result.imported.length > 0) toast.success(`已导入 ${result.imported.length} 个文件`);
    if (result.rejected.length > 0) toast.error(`${result.rejected.length} 个文件未导入`);
  }

  async function toggleStarred(item: ResourceDTO): Promise<void> {
    const message = await setStarred(item.id, !item.starred);
    if (message) toast.error(message);
  }

  function getOcrView(item: ResourceDTO) {
    if (item.kind !== 'file' || item.format !== 'pdf') return null;
    const task = ocrTasks.get(item.id);
    const state = ocrStates[item.id];
    const status = resolveOcrStatus(task, state);
    const progress = resolveOcrProgress(task, state);
    return {
      task,
      state,
      status,
      progress,
      label: ocrStatusLabel(status, progress),
      tone: ocrStatusTone(status),
    };
  }

  async function handleOcrStart(item: ResourceDTO, restart = false): Promise<void> {
    try {
      await startOcr(item.id, restart);
      toast.success(restart ? '已重新开始识别' : '已开始识别');
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function handleOcrTaskAction(
    item: ResourceDTO,
    action: 'pause' | 'resume' | 'cancel' | 'retry'
  ): Promise<void> {
    const task = getOcrView(item)?.task;
    if (!task) return;

    const result: TaskOpResult = await useTaskStore.getState()[action](task.id);
    if (result.ok) {
      const message =
        action === 'pause'
          ? '已暂停'
          : action === 'resume'
            ? '已继续'
            : action === 'cancel'
              ? '已取消识别'
              : '已重新排队';
      toast.success(message);
    } else {
      toast.error(describeOcrTaskFailure(result.reason));
    }
  }

  function renderMenuItems(item: ResourceDTO): ReactNode {
    const ocr = getOcrView(item);
    return (
      <>
        <ContextMenuItem onSelect={() => openRename(item)}>
          <Pencil className="h-4 w-4" />
          重命名
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openMove(item)}>
          <FolderInput className="h-4 w-4" />
          移动到…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void toggleStarred(item)}>
          <Star className="h-4 w-4" />
          {item.starred ? '取消收藏' : '收藏'}
        </ContextMenuItem>
        {ocr && (
          <>
            {!ocr.task && (ocr.status === 'idle' || ocr.status === 'partial') && (
              <ContextMenuItem onSelect={() => void handleOcrStart(item)}>
                <ScanText className="h-4 w-4" />
                {ocr.status === 'idle' ? '识别文字' : '继续识别'}
              </ContextMenuItem>
            )}
            {ocr.task?.status === 'running' && (
              <>
                <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'pause')}>
                  <Pause className="h-4 w-4" />
                  暂停识别
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'cancel')}>
                  <Square className="h-4 w-4" />
                  取消识别
                </ContextMenuItem>
              </>
            )}
            {ocr.task?.status === 'paused' && (
              <>
                <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'resume')}>
                  <Play className="h-4 w-4" />
                  继续识别
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'cancel')}>
                  <Square className="h-4 w-4" />
                  取消识别
                </ContextMenuItem>
              </>
            )}
            {ocr.task?.status === 'queued' && (
              <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'cancel')}>
                <Square className="h-4 w-4" />
                取消识别
              </ContextMenuItem>
            )}
            {ocr.task?.status === 'failed' && (
              <ContextMenuItem onSelect={() => void handleOcrTaskAction(item, 'retry')}>
                <RotateCcw className="h-4 w-4" />
                重试识别
              </ContextMenuItem>
            )}
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onSelect={() => openDelete(item)}>
          <Trash2 className="h-4 w-4" />
          删除
        </ContextMenuItem>
      </>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke-3 px-3">
        <div className="flex min-w-0 items-center gap-1 text-sm">
          {breadcrumb.map((segment, index) => {
            const last = index === breadcrumb.length - 1;
            return (
              <span key={segment.id ?? 'root'} className="flex min-w-0 items-center gap-1">
                {index > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                {last ? (
                  <span className="truncate font-medium">{segment.name}</span>
                ) : (
                  <button
                    type="button"
                    className="truncate text-muted-foreground hover:text-foreground"
                    onClick={() => void openFolder(segment.id)}
                  >
                    {segment.name}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <ArrowUpDown className="h-4 w-4" />
                {SORT_LABEL[sort]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(SORT_LABEL) as ResourceSort[]).map(key => (
                <DropdownMenuItem key={key} onSelect={() => void setSort(key, direction)}>
                  {sort === key ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                  {SORT_LABEL[key]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void setSort(sort, 'asc')}>
                {direction === 'asc' ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                升序
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void setSort(sort, 'desc')}>
                {direction === 'desc' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="h-4 w-4" />
                )}
                降序
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Filter className="h-4 w-4" />
                {FILTER_OPTIONS.find(option => option.value === activeFilter)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FILTER_OPTIONS.map(option => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => void setFormats(option.value === 'all' ? [] : [option.value])}
                >
                  {activeFilter === option.value ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <SegmentedToggle
            value={viewMode}
            options={[
              { value: 'grid', label: '网格' },
              { value: 'detail', label: '列表' },
            ]}
            onChange={setViewMode}
          />

          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建文件夹
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => void handleImport()}
            disabled={importing}
          >
            <Upload className="h-4 w-4" />
            导入
          </Button>
          <IconButton label="刷新" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="relative h-full overflow-auto p-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">正在加载…</div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              {error}
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                重试
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>这里还没有内容</span>
              <div className="flex gap-2">
                <Button variant="solid" size="sm" onClick={() => void handleImport()}>
                  导入文件
                </Button>
                <Button variant="outline" size="sm" onClick={openCreate}>
                  新建文件夹
                </Button>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="flex flex-wrap gap-1">
              {items.map(item => {
                const ocr = getOcrView(item);
                return (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'group relative flex h-32 w-28 flex-col items-center justify-center gap-1 rounded-lg p-1.5 hover:bg-secondary',
                          selectedIds.includes(item.id) && 'bg-secondary'
                        )}
                        onClick={() => select([item.id])}
                        onDoubleClick={() => {
                          if (item.kind === 'folder') {
                            void openFolder(item.id);
                          } else {
                            useTabsStore
                              .getState()
                              .addTab('preview', { resourceId: item.id, title: item.name });
                          }
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            select([item.id]);
                          }
                        }}
                      >
                        <ResourceIcon kind={item.kind} format={item.format} />
                        <span className="w-full shrink-0 truncate text-center text-xs">
                          {item.name}
                        </span>
                        {ocr && (
                          <span
                            className={cn(
                              'w-full shrink-0 truncate text-center text-[11px]',
                              ocr.status === 'failed'
                                ? 'text-destructive'
                                : ocr.status === 'running'
                                  ? 'text-primary'
                                  : ocr.status === 'partial'
                                    ? 'text-warn-ink'
                                    : 'text-muted-foreground'
                            )}
                          >
                            {ocr.label}
                          </span>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon
                              aria-label="更多"
                              className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100"
                              onClick={event => event.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openRename(item)}>
                              <Pencil className="h-4 w-4" />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openMove(item)}>
                              <FolderInput className="h-4 w-4" />
                              移动到…
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void toggleStarred(item)}>
                              <Star className="h-4 w-4" />
                              {item.starred ? '取消收藏' : '收藏'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => openDelete(item)}
                            >
                              <Trash2 className="h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>{renderMenuItems(item)}</ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">名称</th>
                  <th className="px-2 py-2 text-left font-medium">类型</th>
                  <th className="px-2 py-2 text-left font-medium">大小</th>
                  <th className="px-2 py-2 text-left font-medium">修改时间</th>
                  <th className="px-2 py-2 text-left font-medium">分片</th>
                  <th className="px-2 py-2 text-left font-medium">向量化</th>
                  <th className="px-2 py-2 text-left font-medium">OCR</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const ocr = getOcrView(item);
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'hover:bg-secondary',
                        selectedIds.includes(item.id) && 'bg-secondary'
                      )}
                      onClick={() => select([item.id])}
                      onDoubleClick={() => {
                        if (item.kind === 'folder') {
                          void openFolder(item.id);
                        } else {
                          useTabsStore
                            .getState()
                            .addTab('preview', { resourceId: item.id, title: item.name });
                        }
                      }}
                    >
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {item.kind === 'folder' ? (
                            <ResourceIcon kind="folder" size="sm" />
                          ) : (
                            <ResourceIcon kind="file" format={item.format} size="sm" />
                          )}
                          <span className="truncate">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {item.kind === 'folder'
                          ? '文件夹'
                          : item.format
                            ? FORMAT_LABEL[item.format]
                            : '—'}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {item.kind === 'folder' ? '—' : formatBytes(item.sizeBytes)}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {formatDate(item.updatedAt)}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {ocr?.state?.chunkCount ?? '—'}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">—</td>
                      <td className="px-2 py-2">
                        {ocr ? (
                          <Badge variant="outline" tone={ocr.tone}>
                            {ocr.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selectedFile && (
          <ResourceDetailDrawer resource={selectedFile} onClose={() => select([])} />
        )}
      </div>

      <Dialog open={dialogOpen && dialog?.kind === 'create'} onOpenChange={setDialogOpen}>
        <DialogContent onCloseAutoFocus={event => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draftName}
            placeholder="文件夹名称"
            onChange={event => setDraftName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="solid" size="sm" disabled={busy} onClick={() => void handleCreate()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen && dialog?.kind === 'rename'} onOpenChange={setDialogOpen}>
        <DialogContent onCloseAutoFocus={event => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="solid" size="sm" disabled={busy} onClick={() => void handleRename()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen && dialog?.kind === 'move'} onOpenChange={setDialogOpen}>
        <DialogContent onCloseAutoFocus={event => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>移动到</DialogTitle>
          </DialogHeader>
          <FolderPicker value={moveTarget} onChange={setMoveTarget} />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button variant="solid" size="sm" disabled={busy} onClick={() => void handleMove()}>
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent onCloseAutoFocus={event => event.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleteTarget?.name ?? ''}」？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={busy}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
