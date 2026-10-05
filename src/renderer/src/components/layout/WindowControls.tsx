import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Copy as RestoreIcon, Minus, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 窗口控件：最小化 / 最大化（还原） / 关闭 */
export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // 初始化时查询当前状态
    window.api.isMaximized().then(setIsMaximized);
    // 订阅主进程推送的状态变化
    window.api.onMaximizedStateChanged(setIsMaximized);
  }, []);

  return (
    <div className="flex gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => window.api.minimize()}
        className="h-8 w-8 rounded-full hover:bg-foreground/15"
        title="最小化"
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => window.api.maximize()}
        className="h-8 w-8 rounded-full hover:bg-foreground/15 [&_svg]:size-3"
        title={isMaximized ? '还原' : '最大化'}
      >
        {isMaximized ? <RestoreIcon /> : <Square />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => window.api.close()}
        className="h-8 w-8 rounded-full hover:bg-destructive hover:text-destructive-foreground"
        title="关闭"
      >
        <X />
      </Button>
    </div>
  );
}
