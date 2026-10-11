import { toast } from 'sonner';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useConfigStore } from '@/stores/config-store';
import type { ReaderLayout, ReaderMode } from '@shared/config';

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

/**
 * 阅读设置：翻页方式与正文栏数。
 *
 * 两项都只对流式文档（EPUB）生效——固定版式（PDF、pre-paginated EPUB）既没有分栏也没有
 * 连续滚动，阅读器按 `view.isFixedLayout` 整体跳过。写入后主进程广播快照，阅读器订阅到即重排。
 */
export function ReaderSettings() {
  const mode = useConfigStore(state => state.config.reader?.mode ?? 'paginated');
  const layout = useConfigStore(state => state.config.reader?.layout ?? 'single');
  const writeConfig = useConfigStore(state => state.set);

  /** 写回单个配置项。失败只提示，界面显示什么由主进程广播的快照决定。 */
  const write = async (path: ['reader', 'mode' | 'layout'], value: string): Promise<void> => {
    const error = await writeConfig(path, value);
    if (error) toast.error(`保存失败：${error}`);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-background p-3">
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

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">正文栏数</span>
          <SegmentedToggle
            value={layout}
            options={LAYOUT_OPTIONS}
            onChange={next => void write(['reader', 'layout'], next)}
          />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          只在翻页方式下生效，滚动模式是单列连续排布。
        </p>
      </div>
    </div>
  );
}
