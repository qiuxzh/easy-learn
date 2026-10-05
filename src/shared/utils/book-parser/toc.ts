import type { FoliateTocItem } from '@/components/reader/foliate-types';
import type { TOCItem } from '@shared/types/books';

/**
 * foliate-js toc → 项目 TOCItem，递归展平并生成稳定 id。
 * id 为扁平递增编号，跨章节唯一，BookViewer 定位用。
 */
export function flattenToc(rawToc: FoliateTocItem[], level = 0, counter = { value: 0 }): TOCItem[] {
  return rawToc.map(node => {
    const item: TOCItem = {
      id: String(counter.value),
      title: node.label ?? '',
      level,
      href: node.href,
    };
    counter.value += 1;
    if (node.subitems?.length) {
      item.subitems = flattenToc(node.subitems, level + 1, counter);
    }
    return item;
  });
}
