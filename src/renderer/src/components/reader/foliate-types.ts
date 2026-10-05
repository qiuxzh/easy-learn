// ── foliate-js 类型定义 ────────────────────────────────────────
// 根据 node_modules/foliate-js/view.js 和 paginator.js 源码整理
// <foliate-view> 是自定义元素（closed Shadow DOM），无官方类型声明

// ============================================================
// 渲染器 / View 相关类型
// ============================================================

/**
 * foliate-js `goTo()` / `resolveNavigation()` 接受的导航目标。
 *
 * 实际解析逻辑（view.js resolveNavigation）：
 * - `number` → 作为章节索引，如 `0`（第一章）、`3`（第四章）
 * - `{ fraction: number }` → 按总阅读进度跳转，`0` 开头 `1` 结尾，如 `{ fraction: 0.5 }` 跳到一半位置
 * - `string` → 有两种可能，按顺序尝试：
 *   1. 以 `"epubcfi("` 开头 → 当作 CFI 解析，如 `"epubcfi(/6/2[cover]!/4/2/2)"`
 *   2. 否则 → 当作书籍内的 href，由 `book.resolveHref()` 处理，如 `"chapter1.xhtml#p1"`
 */
export type FoliateNavTarget = number | string | { fraction: number };

/** 解析后的导航结果（view.js resolveNavigation / goTo 返回值） */
export interface FoliateResolvedNav {
  index: number;
  anchor?: (doc: Document) => Element | Range;
}

/**
 * `<foliate-view>` 的 `relocate` 自定义事件 detail（view.js #onRelocate 参数）。
 *
 * `reason` 触发原因：
 * - `'snap'` — 翻页吸附完成（页面切换）
 * - `'page'` — 页码变化
 * - `'scroll'` — 滚动模式下的滚动
 * - `'selection'` — 用户选中文本
 * - `'navigation'` — 程序化导航（goTo/prev/next）
 * - `'anchor'` — 锚点定位后
 *
 * 注意：`relocate` 事件 detail 不包含 `view.lastLocation` 中的
 * `tocItem`/`pageItem`/`cfi`，那些是 `lastLocation` 属性独有的。
 */
export interface FoliateRelocateDetail {
  reason: 'snap' | 'page' | 'scroll' | 'selection' | 'navigation' | 'anchor';
  range: Range;
  index: number;
  fraction: number;
  size?: number;
}

/** 阅读进度（SectionProgress.getProgress 返回值，view.js #onRelocate 拼接） */
export interface FoliateProgress {
  fraction: number;
  section: { current: number; total: number };
  location: { current: number; next: number; total: number };
  time: { section: number; total: number };
}

/** 目录 / 页码项（TOCProgress 内部结构） */
export interface FoliateTOCItem {
  id: number;
  label: string;
  href?: string;
  subitems?: FoliateTOCItem[];
}

/**
 * 阅读器最后记录的位置。
 * 在每次 `relocate` 事件中由 `view.#onRelocate` 构建（view.js:316-324）。
 *
 * 构建方式：
 * ```
 * const progress = sectionProgress.getProgress(index, fraction, size) ?? {}
 * this.lastLocation = {
 *   ...progress,   // 展开 FoliateProgress 的所有字段
 *   tocItem,        // 当前匹配的目录项（TOCProgress.getProgress），可能 null
 *   pageItem,       // 当前匹配的页码项（pageList），可能 null
 *   cfi,            // view.getCFI(index, range) 生成的 CFI 字符串
 *   range,          // 当前可见区域的 Range
 * }
 * ```
 * 注：`relocate` 事件本身发出的 detail 不包含 tocItem/pageItem/cfi，
 * 这些是 `lastLocation` 独有的增强字段。
 */
export interface FoliateLastLocation extends Partial<FoliateProgress> {
  tocItem?: FoliateTOCItem | null;
  pageItem?: FoliateTOCItem | null;
  cfi: string;
  range: Range;
}

/** 标注对象 */
export interface FoliateAnnotation {
  value: string;
  label?: string;
}

/** 搜索结果 */
export interface FoliateSearchResult {
  progress?: number;
  label?: string;
  cfi?: string;
  excerpt?: string;
  subitems?: Array<{ cfi: string; excerpt: string }>;
  index?: number;
}

/** 导航历史（view.js History 类） */
export interface FoliateHistory extends EventTarget {
  pushState(x: unknown): void;
  replaceState(x: unknown): void;
  back(): void;
  forward(): void;
  clear(): void;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** 语言信息（view.js languageInfo 返回值） */
export interface FoliateLanguageInfo {
  canonical?: string;
  locale?: Intl.Locale;
  isCJK?: boolean;
  direction?: 'ltr' | 'rtl';
}

/** 渲染器（<foliate-paginator> 或 <foliate-fxl>）公共接口 */
export interface FoliateRenderer extends HTMLElement {
  open(book: unknown): void;
  goTo(target: {
    index: number;
    anchor?: (doc: Document) => Element | Range;
    select?: boolean;
  }): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  prevSection(): Promise<void>;
  nextSection(): Promise<void>;
  firstSection(): Promise<void>;
  lastSection(): Promise<void>;
  /** 注入样式（翻页后自动重新应用） */
  setStyles(styles: string | [string, string]): void;
  /** 获取已加载的章节文档列表 */
  getContents(): Array<{
    doc: Document;
    index: number;
    overlayer?: unknown;
  }>;
  /** 滚动到指定锚点 */
  scrollToAnchor(anchor: Range | Element, smooth?: boolean): Promise<void>;
  focusView(): void;
  destroy(): void;
  readonly scrolled: boolean;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly size: number;
  readonly pages: number;
  readonly page: number;
  columnCount: number;
}

/** <foliate-view> 自定义元素的完整类型。
 *  参考 foliate-js view.js 源码，按功能分组。 */
export interface FoliateViewElement extends HTMLElement {
  // ── 书籍加载与生命周期 ──
  /** 打开书籍，支持 File / FileEntry / Book 对象或 URL 字符串 */
  open(book: unknown): Promise<void>;
  /** 关闭书籍，销毁渲染器，清理所有资源 */
  close(): void;
  /**
   * 导航到初始位置。
   * @param opt.lastLocation - 上次保存的位置（CFI），优先恢复
   * @param opt.showTextStart - true 则跳到正文起始
   */
  init(opt: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;

  // ── 页面导航 ──
  /** 跳转到指定目标 */
  goTo(target: FoliateNavTarget): Promise<FoliateResolvedNav | undefined>;
  /** 按总进度跳转（0-1） */
  goToFraction(frac: number): Promise<void>;
  /** 跳转到正文起始 */
  goToTextStart(): Promise<void>;
  /** 上一页 */
  prev(distance?: number): Promise<void>;
  /** 下一页 */
  next(distance?: number): Promise<void>;
  /** 向左翻页（按书籍文字方向自动适配） */
  goLeft(): Promise<void>;
  /** 向右翻页（按书籍文字方向自动适配） */
  goRight(): Promise<void>;

  // ── 文本选择 ──
  /** 选中并跳转到目标位置 */
  select(target: FoliateNavTarget): Promise<void>;
  /** 清除所有选中 */
  deselect(): void;

  // ── 搜索 ──
  /** 全文搜索，返回异步生成器，迭代到 "done" 结束 */
  search(opts: {
    query: string;
    index?: number;
    caseSensitive?: boolean;
    diacriticsSensitive?: boolean;
  }): AsyncGenerator<FoliateSearchResult, 'done', undefined>;
  /** 清除搜索结果 */
  clearSearch(): void;

  // ── 标注（高亮 / 下划线等） ──
  /** 添加标注。remove=true 时删除标注 */
  addAnnotation(
    annotation: FoliateAnnotation,
    remove?: boolean
  ): Promise<{ index: number; label: string } | undefined>;
  /** 删除标注 */
  deleteAnnotation(
    annotation: FoliateAnnotation
  ): Promise<{ index: number; label: string } | undefined>;
  /** 导航到标注位置 */
  showAnnotation(annotation: FoliateAnnotation): Promise<void>;

  // ── TTS / 有声书 ──
  /** 初始化文字转语音 */
  initTTS(granularity?: 'word' | 'sentence'): Promise<void>;
  /** 播放有声书同步朗读 */
  startMediaOverlay(): Promise<void>;

  // ── 位置信息 ──
  /** 根据章节索引和 Range 生成 CFI 字符串 */
  getCFI(index: number, range: Range): string;
  /** 将 CFI 字符串解析为导航对象 */
  resolveCFI(cfi: string): FoliateResolvedNav;
  /** 解析导航目标（不跳转，仅解析） */
  resolveNavigation(target: FoliateNavTarget): FoliateResolvedNav | undefined;
  /** 各章节占总进度的分数数组 */
  getSectionFractions(): number[];
  /** 获取指定位置匹配的目录项和页码项 */
  getProgressOf(
    index: number,
    range: Range
  ): { tocItem?: FoliateTOCItem | null; pageItem?: FoliateTOCItem | null };
  /** 获取目标对应的目录项 */
  getTOCItemOf(target: FoliateNavTarget): Promise<FoliateTOCItem | undefined>;

  // ── 属性 ──
  /** 当前打开的书籍对象 */
  book: unknown;
  /** 书籍语言信息 */
  language: FoliateLanguageInfo;
  /** 是否为固定布局 */
  isFixedLayout: boolean;
  /** 上一次 relocate 事件的位置快照 */
  lastLocation: FoliateLastLocation | null;
  /** 导航历史 */
  history: FoliateHistory;
  /** 渲染器（<foliate-paginator> 或 <foliate-fxl>），open() 之后才存在 */
  renderer?: FoliateRenderer;
  /** 媒体覆盖（有声书同步），仅有声书有值 */
  mediaOverlay: unknown | null;
  /** TTS 实例，调用 initTTS() 后有值 */
  tts: unknown | null;
}

/**
 * <foliate-view> 的能力投影。
 *
 * 为什么需要它：foliate-view 是 DOM 节点（继承 HTMLElement），其类型链存在
 * 循环引用（HTMLElement ↔ Document ↔ Element），immer 的 WritableNonArrayDraft
 * 无法深克隆 DOM 节点，直接把 view 引用存进 store 会触发类型不兼容。
 * BookViewer 构造 view 时把需要的操作方法闭包到这个对象，再注入到 store。
 * 调用方通过 operator 调 foliate 方法，无需感知 view 存在。
 */
export interface ReaderViewOperator {
  goTo(target: FoliateNavTarget): Promise<FoliateResolvedNav | undefined>;
  goToFraction(frac: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  next(distance?: number): Promise<void>;
  /** 最近一次 relocate 事件的位置快照。view 未初始化完成时返回 null */
  getLastLocation(): FoliateLastLocation | null;
}

// ============================================================
// 书籍对象（foliate-js 解析 EPUB 后的 Book 对象）类型
// ============================================================

/** 章节。foliate-js 通过 load() 拿到渲染内容（URL/data URI/字符串）。 */
export interface FoliateSection {
  /** 返回可渲染的资源 URL/字符串；可能异步 */
  load(): string | Promise<string>;
  /** 可选：释放资源 */
  unload?: () => void;
  /** 返回 Document 对象，用于搜索等。foliate-js 文档标为 optional */
  createDocument?: () => Document | Promise<Document>;
  /** 字节大小，用于展示阅读进度 */
  size?: number;
  /** "no" 时表示不属于线性阅读序列（EPUB linear 属性） */
  linear?: string;
  /** 章节基础 CFI（'!' 之前的部分） */
  cfi?: string;
  /** 唯一 id；TOC 反查时作为 Map 键使用，类型任意但需可作为 Map key */
  id: string;
  /** 翻页方向 */
  dir?: 'ltr' | 'rtl' | string;
}

/** 目录/页表中的单个条目。subitems 用于层级嵌套。 */
export interface FoliateTocItem {
  label: string;
  /** 目标 href，不一定是合法 URL，仅用于 resolveHref 二次解析 */
  href: string;
  subitems?: FoliateTocItem[];
}

/** 元数据。大致遵循 Readium Web Publication Manifest。 */
export interface FoliateMetadata {
  /** 标题可为 string 或 { lang: string } 形式 */
  title?: string | { [lang: string]: string };
  /** 作者/创建者数组 */
  creator?: FoliateCreator[];
  language?: string | string[];
  publisher?: string;
  identifier?: string;
  description?: string;
  /** 允许其他任意 Readium manifest 字段透传 */
  [key: string]: unknown;
}

/** 元数据中的 creator 条目。 */
export interface FoliateCreator {
  name?: string | { [lang: string]: string };
  /** 排序名（如 "Doe, John"） */
  fileAs?: string;
}

/** rendition 配置；layout='pre-paginated' 走固定布局渲染器。 */
export interface FoliateRendition {
  layout?: 'pre-paginated' | 'reflowable' | string;
  [key: string]: unknown;
}

/** foliate-js 解析出的资源引用（封面等）。 */
export interface FoliateResources {
  cover?: { href?: string };
}

/** resolveHref / resolveCFI 返回的跳转目标。 */
export interface FoliateDestination {
  /** 命中的章节在 sections 数组中的下标 */
  index: number;
  /** 给一个 Document，返回元素或 Range；可为 null */
  anchor?: (doc: Document) => Element | Range | null;
}

/**
 * foliate-js 解析每本书后返回的对象结构。
 * 大多数字段为 optional；至少需要 .sections 且每节需要 .load()，否则无可渲染。
 */
export interface FoliateBook {
  /** 章节数组。foliate-js 读取核心入口 */
  sections: FoliateSection[];
  /** 目录树（Readium 风格） */
  toc?: FoliateTocItem[];
  /** 页表（同 toc 结构，用于页码定位） */
  pageList?: FoliateTocItem[];
  /** 元数据 */
  metadata: FoliateMetadata;
  /** rendition 配置；layout 为 'pre-paginated' 时用固定布局渲染 */
  rendition?: FoliateRendition;
  /** 资源引用（封面等） */
  resources?: FoliateResources;
  /** 转换钩子（EventTarget），监听 "data" 事件对加载的内容做变换 */
  transformTarget?: EventTarget;

  // ---- 跳转 / 链接解析 ----
  /** href → { index, anchor(doc) } */
  resolveHref?: (href: string) => FoliateDestination;
  /** CFI → { index, anchor(doc) } */
  resolveCFI?: (cfi: string) => FoliateDestination;
  /** 判断链接是否外部（外部链接应单独打开） */
  isExternal?: (href: string) => boolean;

  // ---- TOC 同步（progress.js 使用）----
  /** href → [sectionId, fragment]；section id 可作为 Map 键 */
  splitTOCHref?: (href: string) => [string | number, unknown] | Promise<[string | number, unknown]>;
  /** (doc, fragment) → Node，对应 splitTOCHref 返回的 fragment */
  getTOCFragment?: (doc: Document, fragment: unknown) => Node | null;
}
