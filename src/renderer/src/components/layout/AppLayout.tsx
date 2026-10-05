import { TopBar } from './TopBar';
import { NavBar } from './NavBar';
import { TabContent } from './TabContent';
import { useUiStore } from '@/stores/ui-store';

/** 应用主布局：顶部栏 + 左侧导航 + 中间内容 */
export function AppLayout() {
  const navCollapsed = useUiStore(s => s.navCollapsed);

  return (
    <div className="flex flex-col h-full">
      <TopBar />
      <div className="flex flex-1 overflow-hidden" style={{ minWidth: 0, minHeight: 0 }}>
        {!navCollapsed && <NavBar />}
        <div className="flex-1 overflow-hidden relative">
          <TabContent />
        </div>
      </div>
    </div>
  );
}
