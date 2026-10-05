import { MathMLToLaTeX } from 'mathml-to-latex';

/** MathML 中可直接复用的 TeX 注解编码。 */
const TEX_ANNOTATION_ENCODINGS = new Set([
  'application/x-tex',
  'application/x-latex',
  'text/x-tex',
]);

/**
 * 公式解析所需的最小节点接口。
 * 同时兼容标准 DOM 节点和 util.ts 为 xmldom 定义的轻量节点类型。
 */
export interface FormulaNodeLike {
  nodeType: number;
  nodeName?: string | null;
  nodeValue?: string | null;
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
  toString?: () => string;
  firstChild?: FormulaNodeLike | null;
  nextSibling?: FormulaNodeLike | null;
}

/** 判断节点是否为 MathML 公式根节点，并兼容带命名空间前缀的文档。 */
export function isMathElement(tagName: string): boolean {
  return tagName === 'math' || tagName.endsWith(':math');
}

/** 判断公式是否应按块级公式处理。 */
export function isDisplayMath(element: FormulaNodeLike): boolean {
  return element.getAttribute?.('display')?.toLowerCase() === 'block';
}

/** 从 MathML 中提取 LaTeX，优先读取标准 TeX annotation，失败时回退到 MathML 转换。 */
export function extractMathFormula(element: FormulaNodeLike): string | null {
  const annotation = findTexAnnotation(element);
  if (annotation) return annotation;

  const source = element.toString?.();
  if (!source) return null;

  try {
    const latex = MathMLToLaTeX.convert(source).trim();
    return latex || null;
  } catch {
    return null;
  }
}

/** 将原始 LaTeX 包成适合阅读与检索的数学定界符。 */
export function formatMathFormula(element: FormulaNodeLike, latex: string): string {
  const delimiter = isDisplayMath(element) ? '$$' : '$';
  return delimiter + latex + delimiter;
}

/** 递归查找带有 TeX 编码的 annotation 内容。 */
function findTexAnnotation(node: FormulaNodeLike): string | null {
  if (node.nodeType === 1) {
    const tagName = node.nodeName?.toLowerCase() ?? '';
    const isAnnotation = tagName === 'annotation' || tagName.endsWith(':annotation');
    const encoding = node.getAttribute?.('encoding')?.trim().toLowerCase();

    if (isAnnotation && encoding && TEX_ANNOTATION_ENCODINGS.has(encoding)) {
      const latex = normalizeLatexFormula(node.textContent ?? '');
      if (latex) return latex;
    }
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    const latex = findTexAnnotation(child);
    if (latex) return latex;
  }
  return null;
}

/** 去掉 annotation 可能自带的一层数学定界符，避免最终内容重复包裹。 */
function normalizeLatexFormula(latex: string): string {
  const normalized = latex.trim();
  if (normalized.startsWith('$$') && normalized.endsWith('$$')) {
    return normalized.slice(2, -2).trim();
  }
  if (normalized.startsWith('$') && normalized.endsWith('$')) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}
