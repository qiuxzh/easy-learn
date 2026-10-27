import { useCallback, useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 面板宽度：像素级拖拽，宽度写 localStorage 跨重启保留 */
export interface PanelWidthOptions {
  /** localStorage 键名；读写失败只影响记忆，不影响本次拖拽 */
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /**
   * 面板贴哪一侧，决定拖拽方向。
   * start 是贴左的分栏（拖它右侧的边，向右变宽），end 是贴右的分栏（拖它左侧的边，向左变宽）。
   */
  edge: 'start' | 'end';
}

/** 挂在分隔条 onPointerDown 上的处理器 */
export type PanelResizeHandler = (event: ReactPointerEvent<HTMLElement>) => void;

/** 把宽度收进合法区间，避免切换屏幕尺寸后残留一个不可用的值 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 读上次宽度；没有记录或记录损坏时返回 null，由调用方回落默认值 */
function readStoredWidth(storageKey: string): number | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 给分栏面板提供可拖拽的像素宽度。
 *
 * 返回的 `resize` 挂在分隔条上即可开始拖拽；拖拽期间的位移由 window 上的指针事件接管，
 * 指针移出分隔条也不会中断。宽度只在拖拽结束后写盘，逐帧写 localStorage 会掉帧。
 */
export function usePanelWidth({ storageKey, defaultWidth, min, max, edge }: PanelWidthOptions) {
  const [width, setWidth] = useState(() =>
    clamp(readStoredWidth(storageKey) ?? defaultWidth, min, max)
  );
  /** 本次拖拽的起点：非 null 表示正在拖，同时用来抑制拖拽期间的写盘 */
  const [dragOrigin, setDragOrigin] = useState<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!dragOrigin) return;

    const sign = edge === 'start' ? 1 : -1;
    const handleMove = (event: PointerEvent) => {
      const next = dragOrigin.width + sign * (event.clientX - dragOrigin.x);
      setWidth(clamp(next, min, max));
    };
    const handleUp = () => setDragOrigin(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    // 指针在窗口外释放时收不到 pointerup，靠 pointercancel 收尾，否则面板会一直跟着鼠标变宽
    window.addEventListener('pointercancel', handleUp);
    // 拖拽中保持手型光标并禁止选中文本：指针移出分隔条后这两项才会失效
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragOrigin, edge, min, max]);

  /** 拖拽结束后才写盘；首次挂载也会写一次默认值，等于把默认宽度记下来 */
  useEffect(() => {
    if (dragOrigin) return;
    localStorage.setItem(storageKey, String(width));
  }, [dragOrigin, width, storageKey]);

  /** 挂在分隔条的 onPointerDown 上 */
  const resize = useCallback<PanelResizeHandler>(
    event => {
      event.preventDefault();
      setDragOrigin({ x: event.clientX, width });
    },
    [width]
  );

  return { width, resize };
}
