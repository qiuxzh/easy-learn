/**
 * 资料库的 IPC 契约。
 *
 * 渲染层只依赖这里的形状；主进程侧的实体在 `@main/contracts/resource` 单独声明，两者由 IPC 层映射。
 */

/** 资料库条目类型。 */
export type ResourceKind = 'folder' | 'file';

/** 资料库支持的格式，同时作为扩展名白名单。 */
export const RESOURCE_FORMATS = ['pdf', 'epub', 'md', 'txt'] as const;

/** 资料库允许导入的文件格式。 */
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number];

/** 列表排序字段。 */
export type ResourceSort = 'name' | 'size' | 'updatedAt';

/** 排序方向。 */
export type SortDirection = 'asc' | 'desc';

/** 目录列表的排序与过滤条件。 */
export interface ResourceListOptions {
  /** 排序字段，默认 name。 */
  sort?: ResourceSort;
  /** 排序方向，默认 asc；文件夹始终排在文件前面。 */
  direction?: SortDirection;
  /** 只保留这些格式的文件；文件夹不受影响。省略表示全部类型。 */
  formats?: ResourceFormat[];
}

/** 渲染层展示的资料库条目。 */
export interface ResourceDTO {
  /** 不可变 id，目录树与外部引用只认它。 */
  id: string;
  /** 父目录 id；顶层为 null。 */
  parentId: string | null;
  /** 条目类型。 */
  kind: ResourceKind;
  /** 完整名称：文件含扩展名，文件夹即目录名。 */
  name: string;
  /** 文件格式；文件夹为 null。 */
  format: ResourceFormat | null;
  /** 文件字节数；文件夹为 null。 */
  sizeBytes: number | null;
  /** 最近一次打开时间，Unix 毫秒；从未打开为 null。 */
  lastOpenedAt: number | null;
  /** 是否已收藏。 */
  starred: boolean;
  /** 子项数量；文件夹为直接子项数，文件为 null。 */
  childrenCount: number | null;
  /** 文件的 app:// 访问地址；文件夹为 null。 */
  url: string | null;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
  /** 最后修改时间，Unix 毫秒。 */
  updatedAt: number;
}

/** 列出某目录的直接子项；文件夹在前，同类按名称升序。 */
export interface ListChildrenInput extends ResourceListOptions {
  /** 父目录 id；null 表示顶层。 */
  parentId: string | null;
}

/** 新建文件夹。 */
export interface CreateFolderInput {
  /** 父目录 id；null 表示顶层。 */
  parentId: string | null;
  /** 文件夹名，不能与同级条目重名。 */
  name: string;
}

/** 导入文件；实际的文件选择由主进程弹框完成。 */
export interface ImportFilesInput {
  /** 导入到哪个目录；null 表示顶层。 */
  parentId: string | null;
}

/** 导入被拒绝的单条原因。 */
export interface RejectedImportDTO {
  /** 被拒绝的源文件绝对路径。 */
  sourcePath: string;
  /** 拒绝原因：扩展名不支持、复制失败或写库失败。 */
  reason: 'UNSUPPORTED_FORMAT' | 'COPY_FAILED' | 'RECORD_FAILED';
}

/** 导入结果；用户取消选择时 `canceled` 为 true 且两个数组为空。 */
export interface ImportFilesResult {
  canceled: boolean;
  imported: ResourceDTO[];
  rejected: RejectedImportDTO[];
}

/** 重命名单个条目，文件与文件夹共用。 */
export interface RenameResourceInput {
  id: string;
  /** 新名称；文件的扩展名必须与原格式一致，省略扩展名时自动补全。 */
  name: string;
}

/** 把条目移动到新父目录。 */
export interface ReparentResourceInput {
  id: string;
  /** 新父目录 id；null 表示顶层。 */
  newParentId: string | null;
}

/** 删除单个文件。 */
export interface DeleteFileInput {
  id: string;
}

/** 递归删除文件夹及其全部子项。 */
export interface DeleteFolderRecursiveInput {
  id: string;
}

/** 列出收藏的条目（文件与文件夹）。 */
export interface ListStarredResourcesInput {
  /** 返回条数，默认 200，上限 500。 */
  limit?: number;
}

/** 设置收藏状态。 */
export interface SetStarredInput {
  id: string;
  starred: boolean;
}

/** 资料库占用的磁盘空间。 */
export interface StorageUsageDTO {
  /** 全部文件字节数之和。 */
  usedBytes: number;
}

/** 路径上的一段：从顶层目录到目标目录。 */
export interface ResourcePathItem {
  /** 目录 id。 */
  id: string;
  /** 目录名。 */
  name: string;
}

/** 取某目录到根的路径。 */
export interface GetResourcePathInput {
  id: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 文档元数据（resource.doc_meta 的 JSON 形状）
//
// 按 `format` 判别：导入时由各格式自己的处理链一次写入，viewer 只读自己那份。
// 目录（toc）的形状由该格式的 viewer 定义，不为其他格式预设统一节点类型。
// ────────────────────────────────────────────────────────────────────────────

/** docMeta 结构版本；改字段或改含义时递增，旧缓存一律视为脏数据重算。 */
export const DOC_META_SCHEMA_VERSION = 1;

/** PDF 目录解析器版本；解析算法升级后旧的 toc 缓存失效重算。 */
export const PDF_TOC_PARSER_VERSION = 1;

/** EPUB 结构解析器版本；解析算法升级后旧的目录与 section 缓存失效重算。 */
export const EPUB_STRUCTURE_PARSER_VERSION = 1;

/** PDF 目录里的单个条目。 */
export interface PdfTocItem {
  /** 目录标题；空标题在解析时过滤。 */
  title: string;
  /** 1-based 物理页；null 表示目标解不出、不可跳转。 */
  page: number | null;
  /** 页面标签（如 "iv"）；没有时省略。 */
  pageLabel?: string | null;
  /** 子条目，由 PDF viewer 自己递归渲染缩进。 */
  items?: PdfTocItem[];
}

/** PDF 的目录数据整体。 */
export interface PdfToc {
  /** 空数组表示「解析过、该资料确实没有内置目录」，不是「没解析」。 */
  items: PdfTocItem[];
  parserVersion: number;
}

interface DocMetaBase<F extends ResourceFormat> {
  /** 与 resource.format 交叉校验；不一致说明文件被替换过，缓存作废。 */
  format: F;
  schemaVersion: number;
}

/** PDF 的文档元数据。 */
export interface PdfDocMeta extends DocMetaBase<'pdf'> {
  pageCount: number;
  hasTextLayer: boolean;
  /** null = 尚未解析（含旧格式缓存）；PdfToc = 解析结果，items 可为 []。 */
  toc: PdfToc | null;
  /** 每页的显示标签；无标签为 null。 */
  pageLabels: string[] | null;
}

/** EPUB 目录里的单个条目。 */
export interface EpubTocItem {
  /** 目录项 id，由目录顺序生成。 */
  id: string;
  /** 目录标题。 */
  title: string;
  /** 层级，从 0 开始。 */
  level: number;
  /** 书内位置，形如 `OEBPS/Text/ch1.xhtml#start`。 */
  href?: string;
  /** 子条目。 */
  subitems?: EpubTocItem[];
}

/** EPUB 的 spine 阅读单元；一个 xhtml 一节。 */
export interface EpubSectionMeta {
  /** spine 下标，从 0 开始。 */
  index: number;
  /** 书内路径，形如 `OEBPS/Text/ch1.xhtml`。 */
  href: string;
  /** 展示标题。 */
  title: string;
  /** 未压缩字节数；未知为 null。 */
  sizeBytes: number | null;
  /** false 表示出版方标记 linear="no"，不在正常阅读顺序。 */
  linear: boolean;
}

/** EPUB 的文档元数据：原书目录树 + spine 阅读单元。 */
export interface EpubDocMeta extends DocMetaBase<'epub'> {
  /** 原书目录树；null = 尚未解析，[] = 解析过但没有目录。 */
  toc: EpubTocItem[] | null;
  /** spine 的 xhtml 列表；null = 尚未解析。 */
  sections: EpubSectionMeta[] | null;
  /** 结构解析器版本；与当前版本不一致时 toc 与 sections 一并作废。 */
  parserVersion: number;
}

/** Markdown 的文档元数据；读取时直接使用源文件，不解析结构。 */
export type MarkdownDocMeta = DocMetaBase<'md'>;

/** 纯文本的文档元数据；读取时直接使用源文件，不解析结构。 */
export type TextDocMeta = DocMetaBase<'txt'>;

export type ResourceDocMeta = PdfDocMeta | EpubDocMeta | MarkdownDocMeta | TextDocMeta;

/** 单个资料的详情；列表 DTO 不带 docMeta，避免目录树传输整份目录。 */
export interface ResourceDetailDTO {
  resource: ResourceDTO;
  docMeta: ResourceDocMeta | null;
}
