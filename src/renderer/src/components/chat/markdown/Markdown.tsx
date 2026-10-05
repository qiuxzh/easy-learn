// 引入 KaTeX 公式渲染所需的样式表
import 'katex/dist/katex.min.css';

import { Streamdown, type Components, type PluginConfig } from 'streamdown';
import { MermaidBlock } from '@/components/chat/markdown/MermaidBlock';
import { SvgBlock } from '@/components/chat/markdown/SvgBlock';

import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
// 启用单 $ 行内公式，解析失败时降级为 errorColor 文字（流式渲染友好）
import { createMathPlugin } from '@streamdown/math';
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
};

const code = createCodePlugin({ themes: ['github-light', 'github-dark'] });
const math = createMathPlugin({ singleDollarTextMath: true });
const plugins: PluginConfig = {
  code,
  math,
  // 修正中文标点附近的 Markdown 强调分隔符配对
  cjk,
  renderers: [
    { language: 'mermaid', component: MermaidBlock },
    { language: 'svg', component: SvgBlock },
  ],
};

export function Markdown({ content, className, isStreaming }: MarkdownProps) {
  const safeContent = normalizeCodeFenceLanguages(fixNumberedListBreaks(content));
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
      <p className="text-[15px] leading-relaxed text-foreground/95" {...props}>
        {children}
      </p>
    ),
    ul: ({ children, ...props }) => (
      <ul
        className="list-disc list-outside space-y-0.5 text-[15px] mb-2 pl-4 text-foreground/95"
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol
        className="list-decimal list-outside space-y-0.5 text-[15px] mb-2 pl-5 text-foreground/95"
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="text-[15px] pl-0.5 text-foreground/95" {...props}>
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
        className="pl-3 italic mb-2 text-[15px] border-l-2 border-border text-foreground/70"
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: ({ ...props }) => <hr className="my-4 border-border" {...props} />,

    table: ({ children, ...props }) => (
      <div className="overflow-x-auto my-3 border border-border rounded-md">
        <table
          className="w-full text-[15px] [&>thead]:bg-muted [&>thead>tr>th]:bg-muted"
          {...props}
        >
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
      <td className="px-3 py-2 border-t border-border text-foreground/95" {...props}>
        {children}
      </td>
    ),
  };

  return (
    <div
      className={cn(
        'chat-markdown',
        'overflow-hidden wrap-break-word',
        '[&_li>p]:inline [&_li>p]:mb-0',
        className
      )}
    >
      <Streamdown components={components} plugins={plugins} isAnimating={isStreaming} animated>
        {safeContent}
      </Streamdown>
    </div>
  );
}
