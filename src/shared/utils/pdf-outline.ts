import { PDF_TOC_PARSER_VERSION, type PdfToc, type PdfTocItem } from '@shared/types/library';

/**
 * PDF outline → 目录树的公共转换逻辑。
 *
 * 只在主进程导入时用：main 侧持有 pdf.js 文档对象，「把 dest 解成页号」由调用方以回调注入，
 * 这里只负责树形整理与并发限流。
 */

/** pdf.js `getOutline()` 返回的节点里我们用到的字段。 */
export interface PdfOutlineSourceNode {
  title?: string | null;
  dest?: string | unknown[] | null;
  items?: PdfOutlineSourceNode[] | null;
}

/** 把一条 outline 目标解成 1-based 页号；解不出返回 null。 */
export type PdfPageResolver = (dest: string | unknown[] | null) => Promise<number | null>;

interface PendingResolution {
  dest: string | unknown[] | null;
  target: PdfTocItem;
}

/** 同时解多少条目标；旧实现串行 await，几百条目录会明显卡住。 */
const RESOLVE_CONCURRENCY = 12;

/**
 * 先把树搭出来（页号一律 null，首屏就能渲染），再并发回填页号。
 * 空标题的节点自身不生成条目，其子项提升到当前层，避免出现一堆空行。
 */
function collect(
  nodes: readonly PdfOutlineSourceNode[],
  out: PdfTocItem[],
  pending: PendingResolution[]
): void {
  for (const node of nodes) {
    const title = (node.title ?? '').trim();
    const children: PdfTocItem[] = [];
    collect(node.items ?? [], children, pending);

    if (!title) {
      out.push(...children);
      continue;
    }

    const item: PdfTocItem = { title, page: null };
    if (children.length > 0) item.items = children;
    out.push(item);
    pending.push({ dest: node.dest ?? null, target: item });
  }
}

/** 把 outline 树转换成 PDF viewer 直接消费的目录数据。 */
export async function buildPdfToc(
  nodes: readonly PdfOutlineSourceNode[] | null,
  resolvePage: PdfPageResolver,
  pageLabels: readonly string[] | null
): Promise<PdfToc> {
  const items: PdfTocItem[] = [];
  const pending: PendingResolution[] = [];
  collect(nodes ?? [], items, pending);

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const job = pending[index];
      const page = await resolvePage(job.dest);
      job.target.page = page;
      if (page !== null) {
        const label = pageLabels?.[page - 1];
        if (label) job.target.pageLabel = label;
      }
    }
  };

  const workerCount = Math.min(RESOLVE_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { items, parserVersion: PDF_TOC_PARSER_VERSION };
}
