import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { SunIcon, MoonIcon, GearIcon, ChatBubbleIcon } from '@radix-ui/react-icons';
import { BookOpen } from 'lucide-react';
import { IconCards } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsDialog } from '@/pages/Settings';
import { useTabsStore, type TabType } from '@/stores/tabs-store';

interface NavItem {
  type: TabType;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { type: 'chat', label: '对话', icon: <ChatBubbleIcon className="h-5 w-5" /> },
  { type: 'bookshelf', label: '书库', icon: <BookOpen className="h-5 w-5" /> },
  { type: 'card-management', label: '闪卡', icon: <IconCards className="h-5 w-5" /> },
];

/** 左侧固定导航栏：上方功能按钮 + 下方暗色/设置 */
export function NavBar() {
  const addTab = useTabsStore(s => s.addTab);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('dark-mode', String(isDark));
  }, [isDark]);

  return (
    <>
      <div className="w-10 border-r border-border flex flex-col shrink-0 bg-secondary/90">
        <div className="flex flex-col flex-1">
          {NAV_ITEMS.map(item => (
            <NavButton key={item.type} label={item.label} onClick={() => addTab(item.type)}>
              {item.icon}
            </NavButton>
          ))}
        </div>

        <div className="flex flex-col">
          <NavButton
            label={isDark ? '切换亮色模式' : '切换暗色模式'}
            onClick={() => setIsDark(v => !v)}
          >
            {isDark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </NavButton>
          <NavButton label="设置" onClick={() => setSettingsOpen(true)}>
            <GearIcon className="h-5 w-5" />
          </NavButton>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

interface NavButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
}

function NavButton({ label, onClick, children }: NavButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-10 w-10 rounded-md hover:bg-accent')}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
