import { DOMParser as XmldomParser, XMLSerializer as XmldomSerializer } from '@xmldom/xmldom';

let initialized = false;

/**
 * 为 foliate-js/epub.js 在 Node 环境提供最小 DOM polyfill。
 * 不模拟完整 HTML DOM，只覆盖 foliate-js 解析 EPUB 时实际调用的 API。
 */
export function initFoliatePolyfill(): void {
  if (initialized) return;
  initialized = true;

  setupDOMParser();
  setupXMLSerializer();
  setupCSS();
  setupBlobURL();
  setupProcessingInstruction();
  setupQuerySelector();
  setupDOMExtras();
}

// ────── DOMParser / XMLSerializer ──────

function setupDOMParser(): void {
  globalThis.DOMParser = XmldomParser as unknown as typeof DOMParser;
}

function setupXMLSerializer(): void {
  globalThis.XMLSerializer = XmldomSerializer as unknown as typeof XMLSerializer;
}

// ────── CSS.escape ──────

function setupCSS(): void {
  const target = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  target.CSS ??= {};
  if (typeof target.CSS.escape !== 'function') {
    // 转义 CSS 选择器中的特殊字符（实现取自 CSSOM 规范的简化版）
    target.CSS.escape = (s: string): string => String(s).replace(/[^\w-]/g, c => `\\${c}`);
  }
}

// ────── URL.createObjectURL / revokeObjectURL ──────

function setupBlobURL(): void {
  const urlObj = globalThis.URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  if (typeof urlObj.createObjectURL === 'function') return;

  const registry = new Map<string, Blob>();
  let counter = 0;
  urlObj.createObjectURL = (blob: Blob): string => {
    const id = `blob:node/${++counter}`;
    registry.set(id, blob);
    return id;
  };
  urlObj.revokeObjectURL = (url: string): void => {
    registry.delete(url);
  };
}

// ────── ProcessingInstruction 引用 ──────
// foliate-js 用 `while (child instanceof ProcessingInstruction)` 做遍历过滤。
// xmldom 内部创建的 PI 节点需要能被识别为 PI，但 xmldom 没把 PI 类挂到 globalThis。
// 解决方案：从解析后的文档中抓出 PI 节点，提取其 constructor 注册到 globalThis。

function setupProcessingInstruction(): void {
  const dummy = new XmldomParser().parseFromString(
    '<?xml version="1.0"?><root><?pi data?></root>',
    'application/xml'
  );
  const piNode = dummy.documentElement?.firstChild;
  if (piNode && piNode.constructor) {
    globalThis.ProcessingInstruction =
      piNode.constructor as unknown as typeof ProcessingInstruction;
  }
}

// ────── querySelector / querySelectorAll shim ──────
// xmldom 元素没有 querySelector。foliate-js 实际用到的选择器模式有限，写一个最小匹配器即可。

type AttrSelector = {
  name: string;
  value?: string;
  /** [*|attr] 命名空间属性匹配：任一命名空间下存在该本地名 */
  namespace?: boolean;
};

type CompoundSelector = {
  /** 元素名（小写），null 表示匹配任意 */
  tag: string | null;
  attrs: AttrSelector[];
  nots: CompoundSelector[];
};

function setupQuerySelector(): void {
  const dummy = new XmldomParser().parseFromString('<root><a/></root>', 'application/xml');
  const ElementProto = Object.getPrototypeOf(dummy.documentElement) as Record<string, unknown>;
  const DocumentProto = Object.getPrototypeOf(dummy) as Record<string, unknown>;

  ElementProto.querySelector = function (this: unknown, sel: string) {
    const all = (this as { querySelectorAll: (s: string) => unknown[] }).querySelectorAll(sel);
    return all[0] ?? null;
  };

  ElementProto.querySelectorAll = function (this: unknown, sel: string): unknown[] {
    return queryAll(this as XmlNode, sel);
  };

  DocumentProto.querySelector = ElementProto.querySelector;
  DocumentProto.querySelectorAll = ElementProto.querySelectorAll;
}

// 极简选择器解析：只支持 foliate-js 用到的形态
//   tag | [attr] | tag[attr] | [attr="value"] | tag[attr="value"]
//   [*|attr] | :not(...) | 上述任意组合
function parseCompound(input: string): CompoundSelector {
  let s = input.trim();
  let tag: string | null = null;
  const attrs: AttrSelector[] = [];
  const nots: CompoundSelector[] = [];

  // 解析 tag
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(s);
  if (tagMatch) {
    tag = tagMatch[1] === '*' ? null : tagMatch[1].toLowerCase();
    s = s.slice(tagMatch[0].length);
  }

  while (s.length > 0) {
    if (s.startsWith('[')) {
      const end = s.indexOf(']');
      if (end === -1) throw new Error(`未闭合的 [: ${input}`);
      attrs.push(parseAttrSelector(s.slice(1, end).trim()));
      s = s.slice(end + 1);
    } else if (s.startsWith(':not(')) {
      const end = matchParen(s, 5);
      nots.push(parseCompound(s.slice(5, end)));
      s = s.slice(end + 1);
    } else {
      throw new Error(`无法解析的选择器片段: ${s}`);
    }
  }

  return { tag, attrs, nots };
}

function parseAttrSelector(inner: string): AttrSelector {
  // [*|attr]
  const nsMatch = /^\*\|([\w-]+)$/.exec(inner);
  if (nsMatch) return { name: nsMatch[1], namespace: true };

  const eqIdx = inner.indexOf('=');
  if (eqIdx === -1) return { name: inner };

  const name = inner.slice(0, eqIdx).trim();
  let value = inner.slice(eqIdx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { name, value };
}

function matchParen(s: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`括号未闭合: ${s}`);
}

interface XmlNode {
  nodeType: number;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  attributes?:
    | { getNamedItem: (name: string) => unknown }
    | ArrayLike<{ name: string; value: string }>;
  firstChild?: XmlNode | null;
  nextSibling?: XmlNode | null;
  parentNode?: XmlParent | null;
}

interface XmlParent extends XmlNode {
  removeChild(child: XmlNode): XmlNode;
  insertBefore(node: XmlNode, ref: XmlNode | null): XmlNode;
  appendChild(node: XmlNode): XmlNode;
}

function matchElement(el: XmlNode, sel: CompoundSelector): boolean {
  if (sel.tag && (el.tagName ?? '').toLowerCase() !== sel.tag) return false;
  for (const attr of sel.attrs) {
    if (!hasAttr(el, attr.name)) return false;
    if (attr.value !== undefined && getAttr(el, attr.name) !== attr.value) return false;
  }
  for (const not of sel.nots) {
    if (matchElement(el, not)) return false;
  }
  return true;
}

function hasAttr(el: XmlNode, name: string): boolean {
  if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
  return getAttr(el, name) !== null;
}

function getAttr(el: XmlNode, name: string): string | null {
  if (typeof el.getAttribute === 'function') return el.getAttribute(name);
  if (el.attributes && 'getNamedItem' in el.attributes) {
    const item = el.attributes.getNamedItem(name);
    return (item as { value?: string } | null)?.value ?? null;
  }
  if (el.attributes && 'length' in el.attributes) {
    for (let i = 0; i < (el.attributes as ArrayLike<{ name: string; value: string }>).length; i++) {
      const a = (el.attributes as ArrayLike<{ name: string; value: string }>)[i];
      if (a.name === name || a.name.endsWith(`:${name}`)) return a.value;
    }
  }
  return null;
}

function queryAll(root: XmlNode, selector: string): unknown[] {
  const parts = splitTopLevelCommas(selector).map(parseCompound);
  const results: XmlNode[] = [];
  walk(root, node => {
    if (node.nodeType !== 1) return;
    for (const sel of parts) {
      if (matchElement(node, sel)) {
        results.push(node);
        return;
      }
    }
  });
  return results;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function walk(root: XmlNode, visit: (node: XmlNode) => void): void {
  visit(root);
  for (let child = root.firstChild ?? null; child; child = child.nextSibling ?? null) {
    walk(child, visit);
  }
}

// ────── 缺失的 DOM 方法补全 ──────

function setupDOMExtras(): void {
  const dummy = new XmldomParser().parseFromString('<root><a/></root>', 'application/xml');
  const ElementProto = Object.getPrototypeOf(dummy.documentElement) as Record<string, unknown>;
  const DocumentProto = Object.getPrototypeOf(dummy) as Record<string, unknown>;

  // Element.replaceWith
  ElementProto.replaceWith = function (this: XmlNode, ...nodes: XmlNode[]) {
    const parent = this.parentNode as XmlParent | null;
    if (!parent) return;
    const next = this.nextSibling ?? null;
    parent.removeChild(this);
    for (const node of nodes) {
      if (next) parent.insertBefore(node, next);
      else parent.appendChild(node);
    }
  };

  // Element.innerText（foliate-js 用于获取节点文本）
  Object.defineProperty(ElementProto, 'innerText', {
    get(this: XmlNode) {
      return extractText(this);
    },
    configurable: true,
  });

  // Document.createProcessingInstruction 在 xmldom 已经存在，跳过
  void DocumentProto;
}

function extractText(node: XmlNode): string {
  let out = '';
  for (let child = node.firstChild ?? null; child; child = child.nextSibling ?? null) {
    if (child.nodeType === 3 /* text */) {
      out +=
        (child as unknown as { data?: string; nodeValue?: string }).data ??
        (child as unknown as { nodeValue?: string }).nodeValue ??
        '';
    } else if (child.nodeType === 1) {
      out += extractText(child);
    }
  }
  return out;
}
