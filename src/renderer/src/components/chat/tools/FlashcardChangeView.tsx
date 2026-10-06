import type { ReactNode } from 'react';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { Markdown } from '@/components/chat/markdown/Markdown';
import { cn } from '@/lib/utils';
import type {
  FlashcardChangeDetail,
  FlashcardChangeField,
  FlashcardChangeSnapshot,
} from '@shared/types/flashcards';

/**
 * 闪卡改动记录的解析与内容渲染。
 * 工具行（AssistantParts 里的单次调用）与 trace 底部的改动汇总共用这里的逻辑，
 * 保证两处对同一条改动的展示完全一致。
 */

/** 三个闪卡写入工具的名称。 */
const FLASHCARD_WRITE_TOOLS = new Set(['create_flashcard', 'update_flashcard', 'delete_flashcard']);

/** 判断工具名是否属于闪卡写入工具。 */
export function isFlashcardWriteTool(toolName: string): boolean {
  return FLASHCARD_WRITE_TOOLS.has(toolName);
}

/** 可变更字段的白名单，用于过滤旧日志里可能出现的未知字段。 */
const CHANGE_FIELDS: FlashcardChangeField[] = ['front', 'back', 'tags', 'groupName'];

/** 字段的中文名。 */
const FIELD_LABELS: Record<FlashcardChangeField, string> = {
  front: '正面',
  back: '反面',
  tags: '标签',
  groupName: '牌组',
};

/** 每种改动对应的图标与标签。 */
export const ACTION_META = {
  create: { label: '新增闪卡', Icon: IconPlus },
  update: { label: '修改闪卡', Icon: IconPencil },
  delete: { label: '删除闪卡', Icon: IconTrash },
} as const;

/** 校验并取出卡片快照；必需字段缺失或类型不符时返回 null。 */
function parseSnapshot(value: unknown): FlashcardChangeSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, groupName, front, back, tags } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof groupName !== 'string') return null;
  if (typeof front !== 'string' || typeof back !== 'string') return null;
  if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) return null;
  return { id, groupName, front, back, tags };
}

/** 校验变更字段列表，过滤掉未知字段；不是数组时返回 undefined。 */
function parseChangedFields(value: unknown): FlashcardChangeField[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (field): field is FlashcardChangeField =>
      typeof field === 'string' && (CHANGE_FIELDS as string[]).includes(field)
  );
}

/** 校验改动字段的旧值，逐项挑出合法字段；形状不符时返回 undefined。 */
function parsePrevious(value: unknown): FlashcardChangeDetail['previous'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const previous: FlashcardChangeDetail['previous'] = {};
  if (typeof record.front === 'string') previous.front = record.front;
  if (typeof record.back === 'string') previous.back = record.back;
  if (typeof record.groupName === 'string') previous.groupName = record.groupName;
  if (Array.isArray(record.tags) && record.tags.every(tag => typeof tag === 'string')) {
    previous.tags = record.tags;
  }
  return previous;
}

/**
 * 从工具详情里解析闪卡改动记录。
 * 详情来自会话日志，可能是旧版本结构或为空，因此逐字段校验，不合法时返回 null。
 */
export function parseFlashcardChange(details: unknown): FlashcardChangeDetail | null {
  if (typeof details !== 'object' || details === null) return null;
  const record = details as Record<string, unknown>;

  const { action } = record;
  if (action !== 'create' && action !== 'update' && action !== 'delete') return null;

  const card = parseSnapshot(record.card);
  if (!card) return null;

  const change: FlashcardChangeDetail = { action, card };
  const changedFields = parseChangedFields(record.changedFields);
  if (changedFields) change.changedFields = changedFields;
  const previous = parsePrevious(record.previous);
  if (previous) change.previous = previous;
  return change;
}

/** 取一段文本的短摘要，折叠状态下显示在工具行右侧。 */
export function summarize(text: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 60 ? plain.slice(0, 60) + '…' : plain || '（空）';
}

/** 标签列表的展示文本。 */
function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join('、') : '无标签';
}

/** 把字段值格式化成展示文本；缺失时给出占位，兼容旧日志。 */
function formatFieldValue(
  field: FlashcardChangeField,
  value: string | string[] | undefined
): string {
  if (field === 'tags') {
    return Array.isArray(value) ? formatTags(value) : '（无）';
  }
  if (typeof value !== 'string') return '（无）';
  return value || '（空）';
}

/** 折叠状态下的一行摘要：新增/删除看正面，修改看改了哪些字段。 */
export function buildDetail(change: FlashcardChangeDetail): string {
  if (change.action === 'update') {
    const fields = change.changedFields ?? [];
    if (fields.length === 0) return '无内容变化';
    return '修改了 ' + fields.map(field => FIELD_LABELS[field]).join('、');
  }
  return summarize(change.card.front);
}

/**
 * 卡片正文的紧凑 Markdown 渲染。
 * 卡片内容本身是 Markdown，与 CardReview 的展示方式保持一致；
 * 但这里处于工具行/汇总块内，需要压小字号与间距，避免把行撑高。
 */
function CompactMarkdown({ content, muted }: { content: string; muted?: boolean }) {
  return (
    <Markdown
      content={content}
      className={cn(
        'text-[12px] leading-[18px]',
        '[&_p]:my-0 [&_p]:text-[12px] [&_p]:leading-[18px]',
        '[&_li]:text-[12px] [&_li]:leading-[18px]',
        '[&_ul]:my-1 [&_ol]:my-1',
        '[&_h1]:my-1 [&_h1]:text-[13px]',
        '[&_h2]:my-1 [&_h2]:text-[13px]',
        '[&_h3]:my-1 [&_h3]:text-[12px]',
        '[&_h4]:my-1 [&_h4]:text-[12px]',
        muted && '[&_p]:text-muted-foreground/60 [&_li]:text-muted-foreground/60'
      )}
    />
  );
}

/** 单行「标签 + 内容」的展示。 */
function SnapshotRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-[12px] leading-[18px]">
        {children}
      </div>
    </div>
  );
}

/** 单行「旧 / 新」的左右分栏对比，便于逐字比对差异。 */
function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground/70">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="mb-0.5 text-[11px] text-muted-foreground/50">旧</div>
          <CompactMarkdown content={before} muted />
        </div>
        <div className="min-w-0 border-l border-border/60 pl-3">
          <div className="mb-0.5 text-[11px] text-muted-foreground/50">新</div>
          <CompactMarkdown content={after} />
        </div>
      </div>
    </div>
  );
}

/** 展开后的内容：新增/删除展示快照，修改展示各字段的新旧对比。 */
export function FlashcardChangeBody({ change }: { change: FlashcardChangeDetail }) {
  const { action, card } = change;

  if (action === 'update') {
    const fields = change.changedFields ?? [];
    if (fields.length === 0) {
      return (
        <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">卡片内容没有变化</div>
      );
    }
    return (
      <div className="flex flex-col divide-y divide-border">
        {fields.map(field => (
          <DiffRow
            key={field}
            label={FIELD_LABELS[field]}
            before={formatFieldValue(field, change.previous?.[field])}
            after={formatFieldValue(field, card[field])}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      <SnapshotRow label="正面">
        {card.front ? <CompactMarkdown content={card.front} /> : '（空）'}
      </SnapshotRow>
      <SnapshotRow label="反面">
        {card.back ? <CompactMarkdown content={card.back} /> : '（空）'}
      </SnapshotRow>
      <SnapshotRow label="牌组">{card.groupName || '（未知）'}</SnapshotRow>
      <SnapshotRow label="标签">{formatTags(card.tags)}</SnapshotRow>
    </div>
  );
}
