import { useState } from 'react';
import { toast } from 'sonner';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useConfigStore } from '@/stores/config-store';
import { READER_ZOOM_RANGE, type ReaderLayout, type ReaderMode } from '@shared/config';

/** 翻页方式选项。 */
const MODE_OPTIONS: readonly [
  { value: ReaderMode; label: string },
  { value: ReaderMode; label: string },
] = [
  { value: 'paginated', label: '翻页' },
  { value: 'scrolled', label: '滚动' },
];

/** 栏数选项，两段式切换的固定顺序。 */
const LAYOUT_OPTIONS: readonly [
  { value: ReaderLayout; label: string },
  { value: ReaderLayout; label: string },
] = [
  { value: 'single', label: '单栏' },
  { value: 'double', label: '双栏' },
];

/** 固定版式的缩放档位；「手动」只是 UI 的一档，配置里存的是数字倍率 */
type ZoomChoice = 'fit-page' | 'fit-width' | 'manual';

const ZOOM_OPTIONS: readonly [
  { value: ZoomChoice; label: string },
  { value: ZoomChoice; label: string },
  { value: ZoomChoice; label: string },
] = [
  { value: 'fit-page', label: '适应页' },
  { value: 'fit-width', label: '适应宽' },
  { value: 'manual', label: '手动' },
];

/**
 * 阅读设置：翻页方式、正文栏数、固定版式缩放。
 *
 * 前两项只对流式文档（EPUB）生效——固定版式（PDF、pre-paginated EPUB）既没有分栏也没有
 * 连续滚动，阅读器按 `view.isFixedLayout` 整体跳过；PDF 只取其中的栏数（决定单页还是跨页）。
 * 缩放只对固定版式生效。写入后主进程广播快照，阅读器订阅到即重排。
 */
export function ReaderSettings() {
  const mode = useConfigStore(state => state.config.reader?.mode ?? 'paginated');
  const layout = useConfigStore(state => state.config.reader?.layout ?? 'single');
  const zoom = useConfigStore(state => state.config.reader?.pdfZoom ?? 'fit-page');
  const writeConfig = useConfigStore(state => state.set);

  // 拖动倍率滑块时先用本地值渲染，松手才落盘：每次 onChange 都写配置会打满 IPC 与落盘
  const [draggingZoom, setDraggingZoom] = useState<number | null>(null);

  const zoomChoice: ZoomChoice = typeof zoom === 'number' ? 'manual' : zoom;
  const storedZoom = typeof zoom === 'number' ? zoom : 1;
  const shownZoom = draggingZoom ?? storedZoom;

  /** 写回单个配置项。失败只提示，界面显示什么由主进程广播的快照决定。 */
  const write = async (
    path: ['reader', 'mode' | 'layout' | 'pdfZoom'],
    value: string | number
  ): Promise<void> => {
    const error = await writeConfig(path, value);
    if (error) toast.error(`保存失败：${error}`);
  };

  /** 切换缩放档位；选「手动」时沿用当前倍率（首次进入默认 1 倍） */
  const handleZoomChoice = (next: ZoomChoice): void => {
    if (next === 'manual') {
      void write(['reader', 'pdfZoom'], storedZoom);
      return;
    }
    void write(['reader', 'pdfZoom'], next);
  };

  /** 松手或失焦时把倍率写回配置 */
  const commitZoom = (): void => {
    if (draggingZoom === null) return;
    void write(['reader', 'pdfZoom'], draggingZoom);
    setDraggingZoom(null);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-stroke-3 bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">翻页方式</span>
          <SegmentedToggle
            value={mode}
            options={MODE_OPTIONS}
            onChange={next => void write(['reader', 'mode'], next)}
          />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          滚动模式上下连续阅读；翻页模式下翻页按钮、方向键与点击页边按屏翻动。
        </p>
      </div>

      <div className="rounded-lg border border-stroke-3 bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">正文栏数</span>
          <SegmentedToggle
            value={layout}
            options={LAYOUT_OPTIONS}
            onChange={next => void write(['reader', 'layout'], next)}
          />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          EPUB 只在翻页方式下生效；PDF 用它选单页或跨页。
        </p>
      </div>

      <div className="rounded-lg border border-stroke-3 bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">PDF 缩放</span>
          <SegmentedToggle value={zoomChoice} options={ZOOM_OPTIONS} onChange={handleZoomChoice} />
        </div>
        {zoomChoice === 'manual' ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={READER_ZOOM_RANGE.min}
              max={READER_ZOOM_RANGE.max}
              step={READER_ZOOM_RANGE.step}
              value={shownZoom}
              aria-label="缩放倍率"
              className="h-1 flex-1 cursor-pointer accent-primary"
              onChange={event => setDraggingZoom(Number(event.target.value))}
              onPointerUp={commitZoom}
              onKeyUp={commitZoom}
              onBlur={commitZoom}
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(shownZoom * 100)}%
            </span>
          </div>
        ) : null}
        <p className="mt-1.5 text-sm text-muted-foreground">
          {zoomChoice === 'manual'
            ? '放大后页面超出视口，在页面上拖拽（不落在文字上）可以平移。'
            : '固定版式（PDF）整页或按宽度铺满阅读区。'}
        </p>
      </div>
    </div>
  );
}
