import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/** Tab 类型，对应一种内容组件。 */
export type TabType =
  | 'home'
  | 'chat'
  | 'bookshelf'
  | 'card-management'
  | 'card-browser'
  | 'card-review'
  | 'reader';

/** 新增 Tab 时透传给目标组件的参数。 */
export interface AddTabParams {
  title?: string;

  bookId?: string;
  /** 请求闪卡浏览页打开新增编辑栏的时间戳。 */
  createCardAt?: number;
  groupId?: string;
}

/** Tab 实例信息。 */
export interface Tab {
  id: string;
  type: TabType;
  title: string;
  /** 固定标签始终位于未固定标签之前。 */
  pinned: boolean;
  params?: AddTabParams;
}

interface TabsState {
  /** 存储所有的标签页信息。 */
  tabs: Tab[];
  /** 当前激活的标签页 ID。 */
  activeTabId: string | null;
  /** 新增一个 Tab 并激活。 */
  addTab: (type: TabType, params?: AddTabParams) => void;
  /** 固定标签页，并将其移动到固定区域末尾。 */
  pinTab: (id: string) => void;
  /** 取消固定标签页，并将其移动到未固定区域开头。 */
  unpinTab: (id: string) => void;
  /** 关闭除目标标签和固定标签以外的标签页。 */
  closeOtherTabs: (id: string) => void;
  /** 在同一固定状态内调整标签顺序。 */
  reorderTabs: (sourceId: string, targetId: string) => void;
  /** 关闭 Tab，并在需要时激活相邻 Tab。 */
  closeTab: (id: string) => void;
  /** 激活指定 Tab。 */
  activateTab: (id: string) => void;
  /** 更新 Tab 标题。 */
  updateTabTitle: (id: string, title: string) => void;
}

/** Tab 类型到默认标题的映射。 */
const TAB_TITLES: Record<TabType, string> = {
  home: '新标签页',
  chat: '对话',
  bookshelf: '书库',
  'card-management': '闪卡',
  'card-browser': '闪卡浏览',
  'card-review': '复习',
  reader: '阅读',
};

/** 单例 Tab 的固定 ID。 */
const SINGLETON_TAB_IDS: Partial<Record<TabType, string>> = {
  home: 'home',
  bookshelf: 'bookshelf',
  'card-management': 'card-management',
  'card-browser': 'card-browser',
};

/** 生成新 Tab 的唯一 ID。 */
function genId(type: TabType, params?: AddTabParams): string {
  if (type === 'card-review' && params?.groupId) return `review-${params.groupId}`;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${type}-${suffix}`;
}

/** 默认首页 Tab。 */
const DEFAULT_TAB: Tab = { id: 'home', type: 'home', title: TAB_TITLES.home, pinned: false };

/** Tab 状态仓库。 */
export const useTabsStore = create<TabsState>()(
  immer((set, get) => ({
    tabs: [DEFAULT_TAB],
    activeTabId: DEFAULT_TAB.id,

    /** 新增 Tab，同牌组复习会复用已有实例。 */
    addTab: (type, params) => {
      const { tabs } = get();
      const fixedId = SINGLETON_TAB_IDS[type];
      const id = fixedId ?? genId(type, params);
      const existing = tabs.find(tab => tab.id === id);

      if (existing) {
        set(state => {
          const existingTab = state.tabs.find(tab => tab.id === id);
          if (existingTab && params) {
            existingTab.title = params.title ?? existingTab.title;
            existingTab.params = { ...existingTab.params, ...params };
          }
          state.activeTabId = id;
        });
        return;
      }

      const title = params?.title ?? TAB_TITLES[type];
      const tab: Tab = { id, type, title, pinned: false, ...(params ? { params } : {}) };
      set(state => {
        state.tabs.push(tab);
        state.activeTabId = id;
      });
    },

    /** 固定标签页，并将其移动到固定区域末尾。 */
    pinTab: id => {
      set(state => {
        const index = state.tabs.findIndex(tab => tab.id === id);
        const target = state.tabs[index];
        if (!target || target.pinned) return;

        state.tabs.splice(index, 1);
        target.pinned = true;
        // 调整顺序，固定的标签页在前
        const firstUnpinnedIndex = state.tabs.findIndex(tab => !tab.pinned);
        state.tabs.splice(
          firstUnpinnedIndex === -1 ? state.tabs.length : firstUnpinnedIndex,
          0,
          target
        );
      });
    },

    /** 取消固定标签页，并将其移动到未固定区域开头。 */
    unpinTab: id => {
      set(state => {
        const index = state.tabs.findIndex(tab => tab.id === id);
        const target = state.tabs[index];
        if (!target || !target.pinned) return;

        state.tabs.splice(index, 1);
        target.pinned = false;
        const firstUnpinnedIndex = state.tabs.findIndex(tab => !tab.pinned);
        state.tabs.splice(
          firstUnpinnedIndex === -1 ? state.tabs.length : firstUnpinnedIndex,
          0,
          target
        );
      });
    },

    /** 关闭除目标标签和固定标签以外的标签页。 */
    closeOtherTabs: id => {
      set(state => {
        if (!state.tabs.some(tab => tab.id === id)) return;

        state.tabs = state.tabs.filter(tab => tab.id === id || tab.pinned);
        if (!state.tabs.some(tab => tab.id === state.activeTabId)) {
          state.activeTabId = id;
        }
      });
    },

    /** 在同一固定状态内调整标签顺序。 */
    reorderTabs: (sourceId, targetId) => {
      if (sourceId === targetId) return;

      set(state => {
        const sourceIndex = state.tabs.findIndex(tab => tab.id === sourceId);
        const targetIndex = state.tabs.findIndex(tab => tab.id === targetId);
        if (sourceIndex === -1 || targetIndex === -1) return;
        if (state.tabs[sourceIndex].pinned !== state.tabs[targetIndex].pinned) return;

        const [movedTab] = state.tabs.splice(sourceIndex, 1);
        state.tabs.splice(targetIndex, 0, movedTab);
      });
    },

    /** 关闭 Tab，关闭最后一个 Tab 时回到首页。 */
    closeTab: id => {
      set(state => {
        const index = state.tabs.findIndex(tab => tab.id === id);
        if (index === -1) return;

        state.tabs.splice(index, 1);
        if (state.tabs.length === 0) {
          state.tabs = [DEFAULT_TAB];
          state.activeTabId = DEFAULT_TAB.id;
          return;
        }

        if (state.activeTabId === id) {
          const fallback = state.tabs[index] ?? state.tabs[index - 1];
          state.activeTabId = fallback.id;
        }
      });
    },

    /** 激活存在的 Tab。 */
    activateTab: id => {
      set(state => {
        if (state.tabs.some(tab => tab.id === id)) {
          state.activeTabId = id;
        }
      });
    },

    /** 更新 Tab 标题。 */
    updateTabTitle: (id, title) => {
      set(state => {
        const tab = state.tabs.find(item => item.id === id);
        if (tab) tab.title = title;
      });
    },
  }))
);
