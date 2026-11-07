import { useEffect, useState } from 'react';
import { Activity, ChevronRight, HardDrive, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIBRARY_ROOT_KEY, useLibraryStore } from '@/stores/library-store';
import { ResourceIcon } from '@/components/ResourceIcon';
import { formatBytes } from '@/utils/library-format';
import type { ResourceDTO } from '@shared/types/library';

/** 一个可展开的目录节点。 */
function TreeFolder({ folder }: { folder: ResourceDTO }) {
  const expanded = useLibraryStore(s => s.expandedFolders[folder.id] ?? false);
  const children = useLibraryStore(s => s.childrenCache[folder.id]);
  const active = useLibraryStore(s => s.view.parentId === folder.id);
  const toggleFolderExpanded = useLibraryStore(s => s.toggleFolderExpanded);
  const openFolder = useLibraryStore(s => s.openFolder);

  const subFolders = (children ?? []).filter(item => item.kind === 'folder');

  return (
    <div>
      <div
        className={cn(
          'flex h-8 items-center gap-1 rounded-md pr-1 text-sm hover:bg-secondary',
          active && 'bg-secondary font-medium'
        )}
      >
        <button
          type="button"
          aria-label={expanded ? '收起目录' : '展开目录'}
          className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => toggleFolderExpanded(folder.id)}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => void openFolder(folder.id)}
        >
          <ResourceIcon kind="folder" size="sm" className="shrink-0" />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {expanded && subFolders.length > 0 && (
        <div className="ml-3 border-l border-stroke-3 pl-1">
          {subFolders.map(child => (
            <TreeFolder key={child.id} folder={child} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 资料库左侧导航：收藏、目录树与存储占用。 */
export function LibrarySidebar() {
  const path = useLibraryStore(s => s.path);
  const childrenCache = useLibraryStore(s => s.childrenCache);
  const loadChildren = useLibraryStore(s => s.loadChildren);
  const treeRevision = useLibraryStore(s => s.treeRevision);
  const starredResources = useLibraryStore(s => s.starredResources);
  const loadStarredResources = useLibraryStore(s => s.loadStarredResources);
  const openFolder = useLibraryStore(s => s.openFolder);
  const storageUsageBytes = useLibraryStore(s => s.storageUsageBytes);
  const loadStorageUsage = useLibraryStore(s => s.loadStorageUsage);

  const [treeOpen, setTreeOpen] = useState(true);

  useEffect(() => {
    void loadChildren(null);
    const expandedIds = Object.keys(useLibraryStore.getState().expandedFolders);
    for (const folderId of expandedIds) void loadChildren(folderId);
    void loadStarredResources();
  }, [loadChildren, treeRevision, loadStarredResources]);

  useEffect(() => {
    void loadStorageUsage();
  }, [loadStorageUsage]);

  const rootFolders = (childrenCache[LIBRARY_ROOT_KEY] ?? []).filter(
    item => item.kind === 'folder'
  );
  const atRoot = path.length === 1;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-stroke-3">
      <div className="flex h-9 shrink-0 items-center px-3 text-sm font-medium">资料库</div>

      <div className="flex h-6 shrink-0 items-center gap-1 px-3 text-xs text-muted-foreground">
        <Star className="h-3 w-3" />
        收藏
      </div>
      <div className="max-h-40 shrink-0 overflow-auto px-2 pb-2">
        {starredResources.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">还没有收藏</div>
        )}
        {starredResources.map(item => (
          <button
            key={item.id}
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-secondary"
            onClick={() => {
              if (item.kind === 'folder') void openFolder(item.id);
            }}
          >
            <ResourceIcon kind={item.kind} format={item.format} size="sm" />
            <span className="truncate">{item.name}</span>
          </button>
        ))}
      </div>

      <div className="my-2 border-t border-stroke-3" />

      <div className="flex h-6 shrink-0 items-center justify-between px-3 text-xs text-muted-foreground">
        <span>目录</span>
        <button
          type="button"
          aria-label={treeOpen ? '收起目录' : '展开目录'}
          onClick={() => setTreeOpen(value => !value)}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', treeOpen && 'rotate-90')}
          />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {treeOpen && (
          <>
            <div
              className={cn(
                'flex h-8 items-center gap-1 rounded-md pr-1 text-sm hover:bg-secondary',
                atRoot && 'bg-secondary font-medium'
              )}
            >
              <span className="h-6 w-5 shrink-0" />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => void openFolder(null)}
              >
                <ResourceIcon kind="folder" size="sm" className="shrink-0" />
                <span className="truncate">资料库</span>
              </button>
            </div>
            {rootFolders.length > 0 ? (
              <div className="ml-3 border-l border-stroke-3 pl-1">
                {rootFolders.map(folder => (
                  <TreeFolder key={folder.id} folder={folder} />
                ))}
              </div>
            ) : (
              <div className="px-2 py-1 text-xs text-muted-foreground">还没有文件夹</div>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        disabled
        className="flex h-8 shrink-0 items-center gap-2 border-t border-stroke-3 px-3 text-xs text-muted-foreground opacity-50"
      >
        <Activity className="h-3.5 w-3.5" />
        处理中
      </button>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-stroke-3 px-3 text-xs text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5" />
        {formatBytes(storageUsageBytes)}
      </div>
    </aside>
  );
}
