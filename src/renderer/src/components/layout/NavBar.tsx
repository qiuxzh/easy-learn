import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, MessageCircle, Moon, Settings, Sun, WalletCards } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { SettingsDialog } from '@/pages/Settings';
import { useTabsStore, type TabType } from '@/stores/tabs-store';

interface NavItem {
  type: TabType;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { type: 'chat', label: '对话', icon: <MessageCircle /> },
  { type: 'bookshelf', label: '书库', icon: <BookOpen /> },
  { type: 'card-management', label: '闪卡', icon: <WalletCards /> },
];

/** 导航栏图标键的统一档：栏底是 secondary，quiet/md 与栏宽匹配，提示朝右避让窗口边缘 */
const NAV_KEY_PROPS = { side: 'right', variant: 'quiet', size: 'md' } as const;

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
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-stroke-3 bg-secondary py-2">
        {NAV_ITEMS.map(item => (
          <IconButton
            key={item.type}
            label={item.label}
            {...NAV_KEY_PROPS}
            onClick={() => addTab(item.type)}
          >
            {item.icon}
          </IconButton>
        ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          <IconButton
            label={isDark ? '切换亮色模式' : '切换暗色模式'}
            {...NAV_KEY_PROPS}
            onClick={() => setIsDark(v => !v)}
          >
            {isDark ? <Sun /> : <Moon />}
          </IconButton>
          <IconButton label="设置" {...NAV_KEY_PROPS} onClick={() => setSettingsOpen(true)}>
            <Settings />
          </IconButton>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
