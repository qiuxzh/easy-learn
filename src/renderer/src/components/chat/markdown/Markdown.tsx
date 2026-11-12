// 复制含公式的选区时把 KaTeX 还原成 $...$ / $$...$$ 文本；KaTeX 运行时与样式改为按需加载
import 'katex/dist/contrib/copy-tex';

import { useEffect } from 'react';
import { Streamdown, type Components, type MathPlugin, type PluginConfig } from 'streamdown';
import remarkMath from 'remark-math';
import { MermaidBlock } from '@/components/chat/markdown/MermaidBlock';
import { SvgBlock } from '@/components/chat/markdown/SvgBlock';
import { MarkmapBlock } from '@/components/chat/markdown/MarkmapBlock';
import { LazyMath } from '@/components/chat/markdown/LazyMath';
import {
  MATH_PLACEHOLDER_CLASS,
  rehypeLazyMath,
  scheduleKatexPrefetch,
} from '@/components/chat/markdown/katex-lazy';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { cn } from '@/lib/utils';

function fixNumberedListBreaks(text: string): string {
  return text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, '$1. ');
}

function normalizeCodeFenceLanguages(text: string): string {
  return text.replace(/```([^\n]*)/g, (_match, langRaw) => {
    const lang = String(langRaw || '')
      .trim()
      .toLowerCase();
    if (!lang) return '```';
    return `\`\`\`${lang.split(/\s+/)[0]}`;
  });
}

export type MarkdownProps = {
  content: string;
  className?: string;
  textContrast?: 'normal' | 'high';
  isStreaming?: boolean;
  /** 为 true 时按纯文本展示模型原始输出，不解析 Markdown、不渲染公式 */
  raw?: boolean;
};

const code = createCodePlugin({ themes: ['github-light', 'github-dark'] });

/** 公式解析沿用 remark-math；KaTeX 渲染推迟到 LazyMath 的按需加载。 */
const math: MathPlugin = {
  name: 'katex',
  type: 'math',
  remarkPlugin: [remarkMath, { singleDollarTextMath: true }],
  rehypePlugin: rehypeLazyMath,
};

/**
 * remend 的 htmlTags 规则把 `<` + 字母当作未闭合 HTML 标签，从 `<` 一直删到文本结尾，
 * 公式（`$k<d$`）与正文（`x<y`）都会中招，关掉。
 */
const remendOptions = { htmlTags: false };

const plugins: PluginConfig = {
  code,
  math,
  // 修正中文标点附近的 Markdown 强调分隔符配对
  cjk,
  renderers: [
    { language: 'mermaid', component: MermaidBlock },
    { language: 'svg', component: SvgBlock },
    { language: 'markmap', component: MarkmapBlock },
  ],
};

const isMathPlaceholder = (className: unknown): boolean =>
  typeof className === 'string' && className.split(/\s+/).includes(MATH_PLACEHOLDER_CLASS);

const placeholderLatex = (node: { properties?: Record<string, unknown> } | undefined): string => {
  const value = node?.properties?.dataLatex;
  return typeof value === 'string' ? value : '';
};

/** 表放在模块作用域：streamdown 的 Block 按组件身份做 memo，渲染中重建这张表会让所有块重新解析。 */
const components: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="text-base font-semibold mt-3 mb-1.5" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-base font-semibold mt-3 mb-1.5" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-sm font-semibold mt-2 mb-1" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-sm font-medium mt-2 mb-1" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="text-body-lg leading-relaxed text-foreground" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="list-disc list-outside space-y-0.5 text-body-lg mb-2 pl-4 text-foreground"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="list-decimal list-outside space-y-0.5 text-body-lg mb-2 pl-7 text-foreground"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-body-lg pl-0.5 text-foreground" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  a: ({ href, children, ...props }) => {
    if (!href) return <span>{children}</span>;
    const isExternal = href.startsWith('http') || href.startsWith('mailto:');
    return (
      <a
        {...props}
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="hover:underline underline-offset-2 text-primary"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="pl-3 italic mb-2 text-body-lg border-l-2 border-stroke-3 text-ink-tertiary"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: ({ ...props }) => <hr className="my-4 border-stroke-3" {...props} />,

  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-3 border border-stroke-3 rounded-md">
      <table className="w-full text-body-lg [&>thead]:bg-muted [&>thead>tr>th]:bg-muted" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="text-left font-medium px-3 py-2 bg-muted" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-3 py-2 border-t border-stroke-3 text-foreground" {...props}>
      {children}
    </td>
  ),
  span: ({ node, ...props }) => {
    if (isMathPlaceholder(props.className)) {
      return <LazyMath latex={placeholderLatex(node)} displayMode={false} />;
    }
    return <span {...props} />;
  },
  div: ({ node, ...props }) => {
    if (isMathPlaceholder(props.className)) {
      return <LazyMath latex={placeholderLatex(node)} displayMode />;
    }
    return <div {...props} />;
  },
};

export function Markdown({ content, className, isStreaming, raw }: MarkdownProps) {
  useEffect(() => {
    scheduleKatexPrefetch();
  }, []);

  if (raw) {
    return (
      <pre
        className={cn(
          'chat-markdown whitespace-pre-wrap wrap-break-word rounded-md border border-stroke-3 bg-surface-2 px-3 py-2 font-mono text-sm leading-6 text-foreground',
          className
        )}
      >
        {content}
      </pre>
    );
  }

  const safeContent = normalizeCodeFenceLanguages(fixNumberedListBreaks(content));

  return (
    <div
      className={cn(
        'chat-markdown',
        'overflow-hidden wrap-break-word',
        '[&_li>p]:inline [&_li>p]:mb-0',
        className
      )}
    >
      <Streamdown
        components={components}
        plugins={plugins}
        isAnimating={isStreaming}
        parseIncompleteMarkdown={isStreaming === true}
        remend={remendOptions}
        animated
      >
        {safeContent}
      </Streamdown>
    </div>
  );
}
