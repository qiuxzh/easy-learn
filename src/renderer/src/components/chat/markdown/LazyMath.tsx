import { useEffect, useState } from 'react';

import {
  ensureKatexLoaded,
  getCachedKatexHtml,
  getLoadedKatex,
  MATH_PLACEHOLDER_CLASS,
  renderKatexHtml,
} from '@/components/chat/markdown/katex-lazy';

export type LazyMathProps = {
  latex: string;
  displayMode: boolean;
};

/**
 * 数学节点渲染。KaTeX 未就绪时先显示 LaTeX 原文，加载完成后自动补渲；
 * 渲染结果由 katex-lazy 的模块级缓存复用，重复公式不再调用 KaTeX。
 */
export function LazyMath({ latex, displayMode }: LazyMathProps) {
  const [, setRevision] = useState(0);
  const katex = getLoadedKatex();
  const cachedHtml = getCachedKatexHtml(latex, displayMode);
  const waitingForKatex = cachedHtml === undefined && katex === null;

  useEffect(() => {
    if (!waitingForKatex) return;
    let cancelled = false;
    ensureKatexLoaded()
      .then(() => {
        if (!cancelled) setRevision(value => value + 1);
      })
      .catch((error: unknown) => {
        console.error('[LazyMath] KaTeX 加载失败', error);
      });
    return () => {
      cancelled = true;
    };
  }, [waitingForKatex]);

  const Tag: 'div' | 'span' = displayMode ? 'div' : 'span';

  if (cachedHtml !== undefined) {
    return (
      <Tag className={MATH_PLACEHOLDER_CLASS} dangerouslySetInnerHTML={{ __html: cachedHtml }} />
    );
  }

  if (katex === null) {
    return <Tag className={`${MATH_PLACEHOLDER_CLASS} katex-loading`}>{latex}</Tag>;
  }

  let html: string | null = null;
  try {
    html = renderKatexHtml(latex, displayMode);
  } catch (error: unknown) {
    console.error('[LazyMath] KaTeX 渲染失败', error, latex);
  }

  if (html === null) {
    return <Tag className={`${MATH_PLACEHOLDER_CLASS} katex-error`}>{latex}</Tag>;
  }

  return <Tag className={MATH_PLACEHOLDER_CLASS} dangerouslySetInnerHTML={{ __html: html }} />;
}
