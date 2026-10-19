import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Copy as RestoreIcon, Minus, Square, X } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';

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
      <IconButton side="bottom" label="最小化" onClick={() => window.api.minimize()}>
        <Minus />
      </IconButton>
      <IconButton
        side="bottom"
        label={isMaximized ? '还原' : '最大化'}
        onClick={() => window.api.maximize()}
      >
        {isMaximized ? <RestoreIcon /> : <Square />}
      </IconButton>
      <IconButton side="bottom" tone="danger" label="关闭" onClick={() => window.api.close()}>
        <X />
      </IconButton>
    </div>
  );
}
