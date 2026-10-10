import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReaderStore } from '@/stores/reader-store';
import { cn } from '@/lib/utils';

/** 拖拽进度条时的跳转节流（ms），避免拖动过程中频繁触发全书重排 */
const SEEK_THROTTLE_MS = 100;

interface ReaderStatusBarProps {
  readerTabId: string;
  className?: string;
}

/**
 * 底部阅读状态栏。
 *
 * 布局：左侧翻页按钮 + 章节名，中间可拖拽进度条，右侧百分比 + 翻页按钮。
 * 进度来自 store 的 currentPosition.percentage（由 foliate relocate 事件维护）。
 */
export function ReaderStatusBar({ readerTabId, className }: ReaderStatusBarProps) {
  const isReady = useReaderStore(s => s.tabs[readerTabId]?.isReady ?? false);
  const chapterTitle = useReaderStore(s => s.tabs[readerTabId]?.currentChapter?.title ?? '');
  const percentage = useReaderStore(s => s.tabs[readerTabId]?.currentPosition?.percentage ?? 0);

  // 拖动期间用本地值渲染，让滑块跟手；跳转落地后交还给真实进度。
  // 交还条件是「指针已抬起」且「最后一次跳转已完成」：若改成固定延时，
  // 跳转慢的时候会先弹回旧位置、再跳到新位置，看起来像进度条自己抖了一下。
  const [dragValue, setDragValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDownRef = useRef(false);
  const lastSeekRef = useRef(0); // 最新发起的跳转序号
  const doneSeekRef = useRef(0); // 已完成的跳转序号

  /** 跳转已落地且指针已抬起时，把进度条交还给真实进度 */
  const releaseIfSettled = useCallback(() => {
    if (!pointerDownRef.current && doneSeekRef.current === lastSeekRef.current) {
      setDragValue(null);
    }
  }, []);

  useEffect(() => {
    // 指针可能在进度条外面抬起，兜底复位，否则控制权永远交不回去
    const onPointerUp = () => {
      pointerDownRef.current = false;
      // 交互结束就让滑块失焦：否则它会一直吃掉左右方向键，
      // 表现为「按左右翻页时页面不翻、进度条自己动一下」
      inputRef.current?.blur();
      releaseIfSettled();
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    };
  }, [releaseIfSettled]);

  const displayPercent = Math.min(100, Math.max(0, dragValue ?? percentage));

  /** 拖动进度条：本地值立即更新，跳转按节流执行 */
  const handleSeek = useCallback(
    (value: number) => {
      setDragValue(value);
      const seq = ++lastSeekRef.current;
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(async () => {
        // seekToFraction 解析时跳转已经落地，store 里的进度就是落地位置
        await useReaderStore.getState().seekToFraction(readerTabId, value / 100);
        doneSeekRef.current = seq;
        releaseIfSettled();
      }, SEEK_THROTTLE_MS);
    },
    [readerTabId, releaseIfSettled]
  );

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 border-t border-border bg-background px-2 text-xs text-muted-foreground',
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="上一页"
        disabled={!isReady}
        className="h-7 w-7 shrink-0"
        onClick={() => useReaderStore.getState().pageTurn(readerTabId, 'prev')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <span className="max-w-[30%] min-w-0 shrink truncate" title={chapterTitle}>
        {chapterTitle || '—'}
      </span>

      {/* 进度条：3px 轨道 + 透明 range 覆盖层（负责交互）+ 跟随的圆点 */}
      <div className="group relative flex h-6 min-w-0 flex-1 items-center">
        <div className="absolute inset-x-0 h-[3px] overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/70"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={displayPercent}
          disabled={!isReady}
          onPointerDown={() => {
            pointerDownRef.current = true;
          }}
          onChange={e => handleSeek(Number(e.target.value))}
          aria-label="阅读进度"
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
        <div
          className="pointer-events-none absolute h-3 w-3 rounded-full border-2 border-background bg-primary shadow-sm transition-transform group-hover:scale-125"
          style={{ left: `calc(${displayPercent}% - 6px)` }}
        />
      </div>

      <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(displayPercent)}%</span>

      <Button
        variant="ghost"
        size="icon"
        aria-label="下一页"
        disabled={!isReady}
        className="h-7 w-7 shrink-0"
        onClick={() => useReaderStore.getState().pageTurn(readerTabId, 'next')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
