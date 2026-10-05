import type { CSSProperties } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WindowControls } from './WindowControls';
import { TabsBar } from './TabsBar';
import { useUiStore } from '@/stores/ui-store';

/** 窗口顶部栏：左侧折叠按钮 + Tab 标签条 + 右侧窗口控件 */
export function TopBar() {
  const navCollapsed = useUiStore(s => s.navCollapsed);
  const toggleNav = useUiStore(s => s.toggleNav);

  return (
    <div
      className="h-10 flex items-center gap-2 px-2 shrink-0 bg-secondary/90"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleNav}
        className="h-8 w-8 shrink-0 hover:bg-foreground/15"
        title={navCollapsed ? '展开导航栏' : '收起导航栏'}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {navCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
      <TabsBar />
      <WindowControls />
    </div>
  );
}
