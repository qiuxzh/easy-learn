import type { FoliateCreator, FoliateMetadata } from '@/components/reader/foliate-types';

/**
 * foliate-js 的 creator 项 → 作者名字字符串。
 * 兼容三种 name 形态：string / 多语言 map / fileAs fallback。
 */
function creatorToName(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const creator = c as FoliateCreator & { role?: string | string[] };
  // 跳过非作者角色：bkp（制作者）、prt（印刷者）、pbl（出版者）等
  const role = creator.role;
  if (typeof role === 'string' && role !== 'aut') return '';
  if (Array.isArray(role) && !role.includes('aut')) return '';
  if (typeof creator.name === 'string') return creator.name.trim();
  if (creator.name && typeof creator.name === 'object') {
    const first = Object.values(creator.name).find((v): v is string => typeof v === 'string');
    return first?.trim() ?? '';
  }
  return creator.fileAs?.trim() ?? '';
}

/**
 * foliate-js 的 author / creator / contributor 字段 → 单字符串作者名。
 * foliate-js 在单条记录时给的是对象，多条记录时给的是数组，统一处理。
 */
function creatorsToString(value: unknown): string | undefined {
  if (!value) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const names = items.map(creatorToName).filter(Boolean);
  return names.length ? names.join(', ') : undefined;
}

/**
 * foliate-js metadata → 作者字符串。
 *
 * 优先级：author（EPUB dc:creator）→ creator（Readium）→ contributor（dc:contributor）。
 *
 * contributor 是必要的 fallback：foliate-js 会把 dc:contributor 单独归类，
 * 但很多中文出版物把作者写在 dc:contributor 而非 dc:creator。
 * contributor 里可能混入 calibre 等制作者元数据，已在 creatorToName 里按 role 过滤。
 */
export function extractAuthor(metadata: FoliateMetadata): string | undefined {
  const meta = metadata as FoliateMetadata & {
    author?: unknown;
    contributor?: unknown;
  };
  return (
    creatorsToString(meta.author) ??
    creatorsToString(meta.creator) ??
    creatorsToString(meta.contributor)
  );
}
