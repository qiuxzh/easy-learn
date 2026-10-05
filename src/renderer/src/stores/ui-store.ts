import { create } from 'zustand';

interface UiState {
  /** 左侧导航栏是否收起 */
  navCollapsed: boolean;
  toggleNav: () => void;
  setNavCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>(set => ({
  navCollapsed: false,
  toggleNav: () => set(state => ({ navCollapsed: !state.navCollapsed })),
  setNavCollapsed: (collapsed: boolean) => set({ navCollapsed: collapsed }),
}));
