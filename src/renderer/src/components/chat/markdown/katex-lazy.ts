/**
 * KaTeX 懒加载与数学节点占位。
 *
 * KaTeX 运行时与样式在第一次出现公式时才加载：rehype 阶段只把数学节点替换成
 * `katex-lazy` 占位元素，真正的 KaTeX 渲染由 LazyMath 在浏览器中完成。
 * 这样整个会话没有任何公式时，KaTeX 不会被打进渲染 chunk。
 */

type Katex = typeof import('katex').default;

let katexModule: Katex | null = null;
let katexLoading: Promise<Katex> | null = null;
let prefetchScheduled = false;

const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: false,
  errorColor: 'var(--color-muted-foreground)',
} as const;

const KATEX_HTML_CACHE_MAX = 200;
const katexHtmlCache = new Map<string, string>();

const cacheKey = (latex: string, displayMode: boolean): string =>
  `${displayMode ? 'd' : 'i'}|${latex}`;

/** 已加载完成的 KaTeX；尚未加载时返回 null。 */
export function getLoadedKatex(): Katex | null {
  return katexModule;
}

/**
 * 触发 KaTeX 运行时与样式加载，同一次加载被重复调用时复用同一个 Promise。
 *
 * 加载失败会清空缓存，允许后续调用重试。
 *
 * @throws 动态加载失败时抛出原始错误
 */
export function ensureKatexLoaded(): Promise<Katex> {
  if (katexModule !== null) return Promise.resolve(katexModule);
  if (katexLoading === null) {
    katexLoading = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([katex]) => {
        katexModule = katex.default;
        return katex.default;
      })
      .catch((error: unknown) => {
        katexLoading = null;
        throw error;
      });
  }
  return katexLoading;
}

/**
 * 在空闲期预取 KaTeX，避免第一条公式先以 LaTeX 原文出现再切换成排版结果。
 *
 * 只在浏览器环境、且 KaTeX 尚未加载时调度一次；预取失败后允许再次调度。
 */
export function scheduleKatexPrefetch(): void {
  if (prefetchScheduled || katexModule !== null || typeof window === 'undefined') return;
  prefetchScheduled = true;
  const run = () => {
    void ensureKatexLoaded().catch(() => {
      prefetchScheduled = false;
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 1000);
  }
}

/** 已缓存的 KaTeX 渲染结果；未渲染过时返回 undefined。 */
export function getCachedKatexHtml(latex: string, displayMode: boolean): string | undefined {
  return katexHtmlCache.get(cacheKey(latex, displayMode));
}

/**
 * 用 KaTeX 渲染 LaTeX 并写入模块级缓存，缓存超过上限时淘汰最早写入的一半条目。
 *
 * @throws KaTeX 尚未加载完成时抛出，调用方需先等待 {@link ensureKatexLoaded}
 */
export function renderKatexHtml(latex: string, displayMode: boolean): string {
  if (katexModule === null) throw new Error('KaTeX 尚未加载');
  const html = katexModule.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
  if (katexHtmlCache.size >= KATEX_HTML_CACHE_MAX) {
    const keys = Array.from(katexHtmlCache.keys()).slice(0, Math.floor(KATEX_HTML_CACHE_MAX / 2));
    for (const key of keys) katexHtmlCache.delete(key);
  }
  katexHtmlCache.set(cacheKey(latex, displayMode), html);
  return html;
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  value?: string;
  children?: HastNode[];
}

const MATH_CLASS = 'language-math';
export const MATH_PLACEHOLDER_CLASS = 'katex-lazy';

function hasMathClass(node: HastNode): boolean {
  const className = node.properties?.className;
  if (Array.isArray(className)) return className.includes(MATH_CLASS);
  return typeof className === 'string' && className.split(/\s+/).includes(MATH_CLASS);
}

function textContentOf(node: HastNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textContentOf).join('');
}

// LaTeX 存放在 dataLatex 属性而不是文本子节点：streamdown 的流式淡入插件会把
// 文本节点拆成多个 span，子节点就不再是字符串，占位元素拿不到原文。
function createMathPlaceholder(tagName: 'div' | 'span', latex: string): HastNode {
  return {
    type: 'element',
    tagName,
    properties: { className: [MATH_PLACEHOLDER_CLASS], dataLatex: latex },
    children: [],
  };
}

/**
 * 递归替换数学节点。remark-rehype 会把块级数学包成
 * `<pre><code class="language-math math-display">`，行内数学是
 * `<code class="language-math math-inline">`。
 */
function replaceMathNodes(children: HastNode[]): void {
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node.type !== 'element') continue;

    if (node.tagName === 'pre') {
      const onlyChild = node.children?.length === 1 ? node.children[0] : undefined;
      if (
        onlyChild?.type === 'element' &&
        onlyChild.tagName === 'code' &&
        hasMathClass(onlyChild)
      ) {
        children[index] = createMathPlaceholder('div', textContentOf(onlyChild));
        continue;
      }
    }

    if (node.tagName === 'code' && hasMathClass(node)) {
      children[index] = createMathPlaceholder('span', textContentOf(node));
      continue;
    }

    if (node.children) replaceMathNodes(node.children);
  }
}

/**
 * 把数学节点替换成 `katex-lazy` 占位元素，块级用 `div`、行内用 `span`，
 * 具体渲染交给注册在 `katex-lazy` 类名上的 LazyMath。
 */
export function rehypeLazyMath() {
  return (tree: HastNode): void => {
    if (tree.children) replaceMathNodes(tree.children);
  };
}
