import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ImportFilesResult,
  ResourceDTO,
  ResourceFormat,
  ResourcePathItem,
  ResourceSort,
  SortDirection,
} from '@shared/types/library';
import type { ResourceOcrStateDTO } from '@shared/types/ocr';

/** 资料库当前打开的真实目录；根目录的 parentId 为 null。 */
export interface LibraryLocation {
  parentId: string | null;
}

/** 面包屑的一段；根的 id 为 null。 */
export interface LibraryPathItem {
  id: string | null;
  name: string;
}

/** 根的展示名。 */
const ROOT_PATH_ITEM: LibraryPathItem = { id: null, name: '资料库' };

/** 目录缓存的键：顶层用固定字符串，避免拿 null 当对象索引。 */
export const LIBRARY_ROOT_KEY = '__root__';

/** 把 parentId 映射成缓存键。 */
function cacheKey(parentId: string | null): string {
  return parentId ?? LIBRARY_ROOT_KEY;
}

/** 按目录取数据；排序与格式过滤只对当前目录生效。 */
async function fetchResources(
  parentId: string | null,
  options: { sort: ResourceSort; direction: SortDirection; formats: ResourceFormat[] }
): Promise<ResourceDTO[]> {
  return window.api.library.listChildren({
    parentId,
    sort: options.sort,
    direction: options.direction,
    formats: options.formats.length > 0 ? options.formats : undefined,
  });
}

interface LibraryState {
  /** 当前目录；根目录的 parentId 为 null。 */
  view: LibraryLocation;
  /** 面包屑，从根到当前目录。 */
  path: LibraryPathItem[];
  /** 当前目录的条目。 */
  items: ResourceDTO[];
  /** 加星条目，供侧栏收藏区展示。 */
  starredResources: ResourceDTO[];
  /** 目录子项缓存，供侧栏树与内容区共用。 */
  childrenCache: Record<string, ResourceDTO[]>;
  /** 目录树中已展开的文件夹。 */
  expandedFolders: Record<string, boolean>;
  /** 内容区选中项。 */
  selectedIds: string[];
  /** 网格或详细信息。 */
  viewMode: 'grid' | 'detail';
  /** 目录视图的排序字段。 */
  sort: ResourceSort;
  /** 排序方向。 */
  direction: SortDirection;
  /** 目录视图的格式过滤；空数组表示全部。 */
  formats: ResourceFormat[];
  loading: boolean;
  error: string | null;
  /** 资料库占用的字节数；未加载为 null。 */
  storageUsageBytes: number | null;
  importing: boolean;
  /** 最近一次导入结果，供页面提示使用。 */
  lastImport: ImportFilesResult | null;
  /** 目录树结构变化时递增，侧栏据此重新拉取展开的目录。 */
  treeRevision: number;
  /** 按资源 id 缓存的 OCR 域状态。 */
  ocrStates: Record<string, ResourceOcrStateDTO>;
  /** 每个资源的 OCR 状态加载态。 */
  ocrLoading: Record<string, boolean>;
  /** 每个资源的 OCR 状态读取错误。 */
  ocrErrors: Record<string, string | null>;

  /** 按当前目录重新取数。 */
  load: () => Promise<string | null>;
  /** 单独加载某目录的子项，用于侧栏树懒加载。 */
  loadChildren: (parentId: string | null) => Promise<string | null>;
  /** 读取加星条目，供侧栏收藏区展示。 */
  loadStarredResources: () => Promise<void>;
  /** 打开某个目录。 */
  openFolder: (parentId: string | null) => Promise<string | null>;
  /** 读取某目录到根的路径。 */
  loadPath: (id: string) => Promise<void>;
  /** 刷新当前目录。 */
  refresh: () => Promise<string | null>;
  /** 修改排序并重新取数。 */
  setSort: (sort: ResourceSort, direction?: SortDirection) => Promise<string | null>;
  /** 修改格式过滤并重新取数。 */
  setFormats: (formats: ResourceFormat[]) => Promise<string | null>;
  /** 展开/收起目录；首次展开时懒加载子项。 */
  toggleFolderExpanded: (folderId: string) => void;
  setViewMode: (mode: 'grid' | 'detail') => void;
  select: (ids: string[]) => void;
  /** 弹框导入文件到当前目录。 */
  importFiles: () => Promise<string | null>;
  /** 在当前目录新建文件夹。 */
  createFolder: (name: string) => Promise<string | null>;
  renameResource: (id: string, name: string) => Promise<string | null>;
  reparentResource: (id: string, newParentId: string | null) => Promise<string | null>;
  deleteFile: (id: string) => Promise<string | null>;
  deleteFolderRecursive: (id: string) => Promise<string | null>;
  setStarred: (id: string, starred: boolean) => Promise<string | null>;
  /** 读取存储占用。 */
  loadStorageUsage: () => Promise<void>;
  /** 读取单个资源的 OCR 域状态。 */
  loadOcrState: (resourceId: string) => Promise<void>;
  /** 批量读取资源的 OCR 域状态，供列表展示。 */
  loadOcrStates: (resourceIds: readonly string[]) => Promise<void>;
  /** 启动识别，返回任务 id。 */
  startOcr: (resourceId: string, restart?: boolean) => Promise<string>;
}

/** 资料库状态仓库。 */
export const useLibraryStore = create<LibraryState>()(
  immer((set, get) => ({
    view: { parentId: null },
    path: [ROOT_PATH_ITEM],
    items: [],
    starredResources: [],
    childrenCache: {},
    expandedFolders: {},
    selectedIds: [],
    viewMode: 'grid',
    sort: 'name',
    direction: 'asc',
    formats: [],
    loading: false,
    error: null,
    storageUsageBytes: null,
    importing: false,
    lastImport: null,
    treeRevision: 0,
    ocrStates: {},
    ocrLoading: {},
    ocrErrors: {},

    load: async () => {
      const { view, sort, direction, formats } = get();
      set(state => {
        state.loading = true;
        state.error = null;
      });

      try {
        const items = await fetchResources(view.parentId, { sort, direction, formats });
        set(state => {
          state.items = items;
          state.loading = false;
          state.childrenCache[cacheKey(view.parentId)] = items;
        });
        return null;
      } catch (e) {
        const message = String(e);
        set(state => {
          state.loading = false;
          state.error = message;
        });
        return message;
      }
    },

    loadChildren: async parentId => {
      try {
        const items = await window.api.library.listChildren({ parentId });
        set(state => {
          state.childrenCache[cacheKey(parentId)] = items;
        });
        return null;
      } catch (e) {
        return String(e);
      }
    },

    openFolder: async parentId => {
      set(state => {
        state.view = { parentId };
        state.items = [];
        state.selectedIds = [];
        state.error = null;
        state.path = [ROOT_PATH_ITEM];
      });
      if (parentId !== null) await get().loadPath(parentId);
      return get().load();
    },

    loadPath: async id => {
      try {
        const segments: ResourcePathItem[] = await window.api.library.getResourcePath({ id });
        set(state => {
          state.path = [
            ROOT_PATH_ITEM,
            ...segments.map(item => ({ id: item.id, name: item.name })),
          ];
        });
      } catch (e) {
        console.warn('[library] loadPath failed:', e);
      }
    },

    refresh: async () => get().load(),

    setSort: async (sort, direction) => {
      set(state => {
        state.sort = sort;
        if (direction) state.direction = direction;
      });
      return get().load();
    },

    setFormats: async formats => {
      set(state => {
        state.formats = formats;
      });
      return get().load();
    },

    toggleFolderExpanded: folderId => {
      const wasExpanded = get().expandedFolders[folderId] ?? false;
      set(state => {
        state.expandedFolders[folderId] = !wasExpanded;
      });
      if (!wasExpanded && !get().childrenCache[folderId]) void get().loadChildren(folderId);
    },

    setViewMode: mode => {
      set(state => {
        state.viewMode = mode;
      });
    },

    select: ids => {
      set(state => {
        state.selectedIds = ids;
      });
    },

    importFiles: async () => {
      if (get().importing) return null;
      const view = get().view;
      const parentId = view.parentId;

      set(state => {
        state.importing = true;
        state.error = null;
      });

      try {
        const result = await window.api.library.importFiles({ parentId });
        set(state => {
          state.importing = false;
          state.lastImport = result;
          state.treeRevision += 1;
        });
        if (!result.canceled) {
          await get().load();
          await get().loadChildren(parentId);
        }
        return null;
      } catch (e) {
        const message = String(e);
        set(state => {
          state.importing = false;
          state.error = message;
        });
        return message;
      }
    },

    createFolder: async name => {
      const parentId = get().view.parentId;

      try {
        await window.api.library.createFolder({ parentId, name });
        set(state => {
          state.treeRevision += 1;
        });
        await get().load();
        await get().loadChildren(parentId);
        return null;
      } catch (e) {
        return String(e);
      }
    },

    renameResource: async (id, name) => {
      try {
        const updated = await window.api.library.renameResource({ id, name });
        set(state => {
          state.items = state.items.map(item => (item.id === id ? updated : item));
          // 目录树与侧栏缓存里仍是旧名字，交给下次展开时重新拉取
          state.childrenCache = {};
          state.treeRevision += 1;
        });
        return null;
      } catch (e) {
        return String(e);
      }
    },

    reparentResource: async (id, newParentId) => {
      try {
        await window.api.library.reparentResource({ id, newParentId });
        set(state => {
          state.childrenCache = {};
          state.selectedIds = [];
          state.treeRevision += 1;
        });
        return get().load();
      } catch (e) {
        return String(e);
      }
    },

    deleteFile: async id => {
      try {
        await window.api.library.deleteFile({ id });
        set(state => {
          state.items = state.items.filter(item => item.id !== id);
          state.selectedIds = [];
          state.childrenCache = {};
          state.treeRevision += 1;
        });
        await get().load();
        return null;
      } catch (e) {
        return String(e);
      }
    },

    deleteFolderRecursive: async id => {
      try {
        await window.api.library.deleteFolderRecursive({ id });
        set(state => {
          state.childrenCache = {};
          state.selectedIds = [];
          state.treeRevision += 1;
          if (state.view.parentId === id) {
            state.view = { parentId: null };
            state.path = [ROOT_PATH_ITEM];
          }
        });
        await get().load();
        return null;
      } catch (e) {
        return String(e);
      }
    },

    setStarred: async (id, starred) => {
      try {
        const updated = await window.api.library.setStarred({ id, starred });
        set(state => {
          state.items = state.items.map(item => (item.id === id ? updated : item));
          state.treeRevision += 1;
        });
        return null;
      } catch (e) {
        return String(e);
      }
    },

    loadStarredResources: async () => {
      try {
        const resources = await window.api.library.listStarredResources({});
        set(state => {
          state.starredResources = resources;
        });
      } catch (e) {
        console.warn('[library] loadStarredResources failed:', e);
      }
    },

    loadStorageUsage: async () => {
      try {
        const usage = await window.api.library.getStorageUsage();
        set(state => {
          state.storageUsageBytes = usage.usedBytes;
        });
      } catch (e) {
        console.warn('[library] loadStorageUsage failed:', e);
      }
    },

    loadOcrState: async resourceId => {
      set(state => {
        state.ocrLoading[resourceId] = true;
        state.ocrErrors[resourceId] = null;
      });

      try {
        const value = await window.api.library.ocrGetState({ resourceId });
        set(state => {
          state.ocrStates[resourceId] = value;
        });
      } catch (e) {
        set(state => {
          state.ocrErrors[resourceId] = String(e);
        });
      } finally {
        set(state => {
          state.ocrLoading[resourceId] = false;
        });
      }
    },

    loadOcrStates: async resourceIds => {
      const ids = [...new Set(resourceIds)];
      if (ids.length === 0) return;

      set(state => {
        for (const id of ids) {
          state.ocrLoading[id] = true;
          state.ocrErrors[id] = null;
        }
      });

      try {
        const values = await window.api.library.ocrGetStates({ resourceIds: ids });
        set(state => {
          for (const [resourceId, value] of Object.entries(values)) {
            state.ocrStates[resourceId] = value;
          }
        });
      } catch (e) {
        set(state => {
          for (const id of ids) state.ocrErrors[id] = String(e);
        });
      } finally {
        set(state => {
          for (const id of ids) state.ocrLoading[id] = false;
        });
      }
    },

    startOcr: async (resourceId, restart = false) => {
      const { taskId } = await window.api.library.ocrStart({ resourceId, restart });
      await get().loadOcrState(resourceId);
      return taskId;
    },
  }))
);
