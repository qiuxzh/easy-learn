import type { CSSProperties } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { WindowControls } from './WindowControls';
import { TabsBar } from './TabsBar';
import { useUiStore } from '@/stores/ui-store';

/** 窗口顶部栏：左侧折叠按钮 + Tab 标签条 + 右侧窗口控件 */
export function TopBar() {
  const navCollapsed = useUiStore(s => s.navCollapsed);
  const toggleNav = useUiStore(s => s.toggleNav);

  return (
    <div
      className="h-10 flex items-center gap-2 px-2 shrink-0 bg-secondary"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <IconButton
        side="bottom"
        label={navCollapsed ? '展开导航栏' : '收起导航栏'}
        onClick={toggleNav}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {navCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </IconButton>
      <TabsBar />
      <WindowControls />
    </div>
  );
}
