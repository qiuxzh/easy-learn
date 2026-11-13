import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RESOURCE_FORMATS } from '@shared/types/library';
import type {
  ImportFilesResult,
  ListStarredResourcesInput,
  RejectedImportDTO,
  ResourceDTO,
  ResourceDetailDTO,
  ResourceFormat,
  ResourceListOptions,
  ResourcePathItem,
  StorageUsageDTO,
} from '@shared/types/library';
import type { ResourceEntity } from '@main/contracts/resource';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { TransactionRunner } from '@main/contracts/transaction';
import { DomainError } from '@main/domain-error';
import { parseDocMeta, serializeDocMeta } from './doc-meta';
import { readEpubDocMeta } from './epub-doc-meta';
import { readPdfDocMeta } from './pdf-doc-meta';
import type { LibraryFileStore } from './library-storage';

/** 扩展名到资料格式：格式就是扩展名本身，只接受白名单内的值。 */
function formatFromExtension(extension: string): ResourceFormat | null {
  const candidate = extension.toLowerCase().replace(/^\./, '');
  return RESOURCE_FORMATS.find(format => format === candidate) ?? null;
}

/** 名称长度上限。 */
const MAX_NAME_LENGTH = 120;

/** 名称中不允许出现的字符。 */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 收藏列表的默认/最大条数。 */
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

/** 把调用方传入的条数限制在合法区间。 */
function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** 校验用户输入的名称，返回去掉首尾空白后的值。 */
function normalizeName(rawName: string): string {
  const name = rawName.trim();
  if (name.length === 0) throw new DomainError('名称不能为空');
  if (name.length > MAX_NAME_LENGTH)
    throw new DomainError(`名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
  if (name === '.' || name === '..') throw new DomainError('名称不合法');
  if (INVALID_NAME_CHARS.test(name)) throw new DomainError('名称不能包含 \\ / : * ? " < > | 字符');
  return name;
}

/** 清洗导入文件的原始文件名；清空后回落到默认名。 */
function sanitizeImportedName(fileName: string): string {
  const cleaned = fileName.trim().replace(INVALID_NAME_CHARS, '_');
  return cleaned.length > 0 ? cleaned : '未命名';
}

/** 给文件补全扩展名；扩展名与格式不一致时拒绝。 */
function normalizeFileRename(name: string, format: ResourceFormat): string {
  const extensionFormat = formatFromExtension(path.extname(name));
  if (!extensionFormat) return `${name}.${format}`;
  if (extensionFormat !== format) throw new DomainError('不能修改文件扩展名');
  return name;
}

/** 创建 LibraryService 所需的依赖。 */
export interface LibraryServiceDeps {
  /** 资料库条目仓储。 */
  resourceRepo: ResourceRepo;
  /** 库内文件落盘与删除。 */
  storage: LibraryFileStore;
  /** 在事务里执行同步逻辑。 */
  transaction: TransactionRunner;
  /** 当前时间，测试可覆盖。 */
  now?: () => number;
}

/** 资料列表的一行；供 AI 工具识别资料与选择读取工具。 */
export interface ResourceListEntry {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  format: ResourceFormat | null;
  sizeBytes: number | null;
  folderId: string | null;
  path: string;
  childrenCount: number | null;
  pageCount: number | null;
  sectionCount: number | null;
  starred: boolean;
}

/** 资料列表的查询条件；分页由工具层处理。 */
export interface ListResourcesInput {
  folderId?: string;
  query?: string;
  format?: ResourceFormat;
  recursive?: boolean;
}

/**
 * 资料库用例服务：目录树的增删改查、文件导入与 AI 资料列表查询。
 *
 * 所有名称冲突、越界移动与格式校验都在这里拒绝；仓储只负责行，磁盘只由 storage 负责。
 */
export class LibraryService {
  private readonly resourceRepo: ResourceRepo;
  private readonly storage: LibraryFileStore;
  private readonly transaction: TransactionRunner;
  private readonly now: () => number;

  constructor(deps: LibraryServiceDeps) {
    this.resourceRepo = deps.resourceRepo;
    this.storage = deps.storage;
    this.transaction = deps.transaction;
    this.now = deps.now ?? Date.now;
  }

  /** 列出某目录的直接子项；`parentId` 为 null 表示顶层。 */
  listChildren(parentId: string | null, options?: ResourceListOptions): ResourceDTO[] {
    return this.toDtos(this.resourceRepo.listChildren(parentId, options));
  }

  /**
   * 列出匹配的资料
   *
   * 有 `query` 时在 `folderId` 子树内按名称搜索（省略 `folderId` 搜整个资料库）；
   * 没有 `query` 时浏览文件夹，`recursive` 展开整棵子树。指定 `format` 时只返回文件。
   *
   * @param input 浏览或搜索条件
   * @returns 文件夹在前、同类按名称升序的全部匹配
   * @throws 文件夹不存在或 `folderId` 指向文件时抛出
   */
  listResources(input: ListResourcesInput = {}): ResourceListEntry[] {
    const folder = this.requireListFolder(input.folderId);
    const query = input.query?.trim();
    const matched = query
      ? this.searchResources(query, folder, input.format)
      : this.browseResources(folder, input.recursive === true, input.format);

    return this.toListEntries(matched);
  }

  /**
   * 新建文件夹。
   *
   * @throws 父目录不存在、名称不合法或同级重名
   */
  createFolder(parentId: string | null, rawName: string): ResourceDTO {
    const name = normalizeName(rawName);
    this.assertParent(parentId);
    this.assertNameAvailable(parentId, name);

    const timestamp = this.now();
    const entity = this.resourceRepo.create({
      id: randomUUID(),
      parentId,
      kind: 'folder',
      name,
      format: null,
      blobPath: null,
      sizeBytes: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.toDtoWithCounts(entity);
  }

  /**
   * 把选中的文件复制进资料库。
   *
   * 顺序处理：每份文件落盘后按格式算好 docMeta，随记录一次写入（不开后台任务），
   * 导入返回时元数据一定可用。目录解析失败只记日志，不影响导入结果。
   * 单个文件失败不中断整批，失败原因随结果返回；同名文件自动追加序号。
   */
  async importFiles(
    parentId: string | null,
    sourcePaths: readonly string[]
  ): Promise<ImportFilesResult> {
    this.assertParent(parentId);

    const imported: ResourceDTO[] = [];
    const rejected: RejectedImportDTO[] = [];

    for (const sourcePath of sourcePaths) {
      const format = formatFromExtension(path.extname(sourcePath));
      if (!format) {
        rejected.push({ sourcePath, reason: 'UNSUPPORTED_FORMAT' });
        continue;
      }

      const id = randomUUID();
      const name = this.uniqueImportedName(parentId, path.basename(sourcePath));

      let stored: { blobPath: string; sizeBytes: number };
      try {
        stored = this.storage.importFile(sourcePath, id, format);
      } catch (e) {
        console.error('[LibraryService] import copy failed:', sourcePath, e);
        rejected.push({ sourcePath, reason: 'COPY_FAILED' });
        continue;
      }

      // PDF 算页数、文本层与目录，EPUB 算目录与 spine 阅读单元；其它格式不加工。
      // 直接用源文件 sourcePath：落盘副本与它内容一致，不需要再拼 dataDir。
      let docMeta: string | null = null;
      if (format === 'pdf') {
        try {
          docMeta = serializeDocMeta(await readPdfDocMeta(sourcePath));
        } catch (e) {
          console.error('[LibraryService] doc meta parse failed:', sourcePath, e);
        }
      } else if (format === 'epub') {
        try {
          docMeta = serializeDocMeta(await readEpubDocMeta(sourcePath));
        } catch (e) {
          console.error('[LibraryService] epub doc meta parse failed:', sourcePath, e);
        }
      }

      try {
        const timestamp = this.now();
        const entity = this.resourceRepo.create({
          id,
          parentId,
          kind: 'file',
          name,
          format,
          blobPath: stored.blobPath,
          sizeBytes: stored.sizeBytes,
          docMeta,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        imported.push(this.toDtoWithCounts(entity));
      } catch (e) {
        console.error('[LibraryService] import record failed:', sourcePath, e);
        this.storage.removeBlobs([stored.blobPath]);
        rejected.push({ sourcePath, reason: 'RECORD_FAILED' });
      }
    }

    return { canceled: false, imported, rejected };
  }

  /**
   * 重命名文件或文件夹。
   *
   * @throws 条目不存在、名称不合法、同级重名，或文件扩展名被改动
   */
  renameResource(id: string, rawName: string): ResourceDTO {
    const entity = this.getEntity(id);
    const normalized = normalizeName(rawName);
    const name =
      entity.kind === 'file'
        ? normalizeFileRename(normalized, this.fileFormat(entity))
        : normalized;

    if (name !== entity.name) this.assertNameAvailable(entity.parentId, name, id);

    const updatedAt = this.now();
    this.resourceRepo.updateName(id, name, updatedAt);
    return this.toDtoWithCounts({ ...entity, name, updatedAt });
  }

  /**
   * 把条目移动到新父目录。
   *
   * @throws 条目或目标目录不存在、目标是文件、移动到自身的子孙目录，或目标目录重名
   */
  reparentResource(id: string, newParentId: string | null): ResourceDTO {
    const entity = this.getEntity(id);

    if (newParentId !== null) {
      const target = this.getEntity(newParentId);
      if (target.kind !== 'folder') throw new DomainError('目标不是文件夹');
      this.assertNotInside(id, newParentId);
    }

    if (entity.parentId === newParentId) return this.toDtoWithCounts(entity);

    this.assertNameAvailable(newParentId, entity.name, id);
    const updatedAt = this.now();
    this.resourceRepo.updateParent(id, newParentId, updatedAt);
    return this.toDtoWithCounts({ ...entity, parentId: newParentId, updatedAt });
  }

  /**
   * 删除单个文件，同时删除库内源文件。
   * TODO BUG：无法删除资料引用的附件，例如 pdf ocr的结果
   * @throws 条目不存在，或目标不是文件
   */
  deleteFile(id: string): void {
    const entity = this.getEntity(id);
    if (entity.kind !== 'file') throw new DomainError('只能对文件执行删除');

    this.transaction(() => this.resourceRepo.deleteByIds([id]));
    this.storage.removeBlobs([entity.blobPath]);
  }

  /**
   * 递归删除文件夹及其全部子项，同时删除库内源文件。
   *
   * @throws 条目不存在，或目标不是文件夹
   */
  deleteFolderRecursive(id: string): void {
    const root = this.getEntity(id);
    if (root.kind !== 'folder') throw new DomainError('只能对文件夹执行递归删除');

    const subtree = this.collectSubtree(root);
    this.transaction(() => this.resourceRepo.deleteByIds(subtree.map(item => item.id)));
    this.storage.removeBlobs(subtree.map(item => item.blobPath));
  }

  /** 按资源 id 解析库内源文件的相对路径，供 app:// 寻址；不是文件时返回 null。 */
  resolveResourceBlob(id: string): string | null {
    const entity = this.resourceRepo.findById(id);
    return entity?.kind === 'file' ? entity.blobPath : null;
  }

  /**
   * 设置收藏状态。
   *
   * @throws 条目不存在
   */
  setStarred(id: string, starred: boolean): ResourceDTO {
    const entity = this.getEntity(id);
    if (entity.starred !== starred) this.resourceRepo.setStarred(id, starred);
    return this.toDtoWithCounts({ ...entity, starred });
  }

  /** 列出收藏的条目；`limit` 默认 200、上限 500。 */
  listStarredResources(input: ListStarredResourcesInput = {}): ResourceDTO[] {
    return this.toDtos(
      this.resourceRepo.listStarredResources(
        clampLimit(input.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
      )
    );
  }

  /** 资料库占用的磁盘空间。 */
  getStorageUsage(): StorageUsageDTO {
    return { usedBytes: this.resourceRepo.sumFileSize() };
  }

  /** 取目录到根的路径，从顶层目录到目标目录；目标不存在时抛错。 */
  getResourcePath(id: string): ResourcePathItem[] {
    const segments: ResourcePathItem[] = [];
    let currentId: string | null = id;

    while (currentId !== null) {
      const entity = this.resourceRepo.findById(currentId);
      if (!entity) throw new DomainError('资源不存在');
      segments.unshift({ id: entity.id, name: entity.name });
      currentId = entity.parentId;
    }

    return segments;
  }

  /**
   * 取单份资料的详情，含 doc_meta 里的目录缓存。
   *
   * 列表 DTO 不带 docMeta，只有预览页打开资料时才读这一份。
   * 缓存的 format 与资源当前 format 不一致说明文件被同名替换过，直接作废。
   */
  getResource(id: string): ResourceDetailDTO {
    const entity = this.getEntity(id);
    const cached = parseDocMeta(this.resourceRepo.findDocMeta(id));
    return {
      resource: this.toDtoWithCounts(entity),
      docMeta: cached && cached.format === entity.format ? cached : null,
    };
  }

  /** 校验列表的文件夹参数；省略表示顶层，指向文件时拒绝。 */
  private requireListFolder(folderId: string | undefined): ResourceEntity | null {
    if (!folderId) return null;
    const folder = this.resourceRepo.findById(folderId);
    if (!folder) throw new DomainError('文件夹不存在');
    if (folder.kind !== 'folder') throw new DomainError('该 id 不是文件夹');
    return folder;
  }

  /** 按名称搜索；有 folder 时限定在它的子树内。 */
  private searchResources(
    query: string,
    folder: ResourceEntity | null,
    format: ResourceFormat | undefined
  ): ResourceEntity[] {
    let matches = this.resourceRepo.searchByName(query);

    if (folder) {
      const scope = this.collectDescendantIds(folder.id);
      matches = matches.filter(item => scope.has(item.id));
    }
    if (format) {
      matches = matches.filter(item => item.kind === 'file' && item.format === format);
    }
    return sortByFolderThenName(matches);
  }

  /** 浏览；递归时按深度优先展开，保持“文件夹在前、同类按名称”的顺序。 */
  private browseResources(
    folder: ResourceEntity | null,
    recursive: boolean,
    format: ResourceFormat | undefined
  ): ResourceEntity[] {
    const entities = recursive
      ? this.collectDescendants(folder?.id ?? null)
      : this.resourceRepo.listChildren(folder?.id ?? null);

    if (!format) return entities;
    return entities.filter(item => item.kind === 'file' && item.format === format);
  }

  /** 收集一个文件夹的全部后代 id（不含自己）。 */
  private collectDescendantIds(folderId: string): Set<string> {
    const ids = new Set<string>();
    const stack = [folderId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const child of this.resourceRepo.listChildren(current)) {
        ids.add(child.id);
        if (child.kind === 'folder') stack.push(child.id);
      }
    }
    return ids;
  }

  /** 按文件夹在前、同类名称升序的深度优先顺序收集子树。 */
  private collectDescendants(parentId: string | null): ResourceEntity[] {
    const result: ResourceEntity[] = [];
    const walk = (currentParentId: string | null): void => {
      for (const child of this.resourceRepo.listChildren(currentParentId)) {
        result.push(child);
        if (child.kind === 'folder') walk(child.id);
      }
    };
    walk(parentId);
    return result;
  }

  /** 文档规模只读已缓存的 doc_meta，不在这里解析文件。 */
  private toListEntries(entities: readonly ResourceEntity[]): ResourceListEntry[] {
    const dtos = this.toDtos([...entities]);
    const paths = this.buildPaths(entities);

    return dtos.map(dto => {
      let pageCount: number | null = null;
      let sectionCount: number | null = null;
      if (dto.kind === 'file') {
        const meta = parseDocMeta(this.resourceRepo.findDocMeta(dto.id));
        if (meta?.format === 'pdf') pageCount = meta.pageCount;
        else if (meta?.format === 'epub') sectionCount = meta.sections?.length ?? null;
      }

      return {
        id: dto.id,
        name: dto.name,
        kind: dto.kind,
        format: dto.format,
        sizeBytes: dto.sizeBytes,
        folderId: dto.parentId,
        path: paths.get(dto.id) ?? dto.name,
        childrenCount: dto.childrenCount,
        pageCount,
        sectionCount,
        starred: dto.starred,
      };
    });
  }

  /** 为一批行计算从顶层到自己的路径；祖先名在同一次调用内缓存。 */
  private buildPaths(entities: readonly ResourceEntity[]): Map<string, string> {
    const repo = this.resourceRepo;
    const paths = new Map<string, string>();
    const cache = new Map<string, string>();

    function resolveById(id: string): string {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const entity = repo.findById(id);
      return entity ? resolveEntity(entity) : '';
    }

    function resolveEntity(entity: ResourceEntity): string {
      const cached = cache.get(entity.id);
      if (cached !== undefined) return cached;
      const parentPath = entity.parentId ? resolveById(entity.parentId) : '';
      const value = parentPath ? `${parentPath}/${entity.name}` : entity.name;
      cache.set(entity.id, value);
      return value;
    }

    for (const entity of entities) {
      paths.set(entity.id, resolveEntity(entity));
    }
    return paths;
  }

  /** 递归收集一棵子树的行，先序。 */
  private collectSubtree(root: ResourceEntity): ResourceEntity[] {
    const entities: ResourceEntity[] = [root];
    const folderIds = [root.id];
    for (let index = 0; index < folderIds.length; index += 1) {
      const children = this.resourceRepo.listChildren(folderIds[index]);
      for (const child of children) {
        entities.push(child);
        if (child.kind === 'folder') folderIds.push(child.id);
      }
    }
    return entities;
  }

  /** 导入时避开同名：`报告.pdf` 冲突后依次尝试 `报告 (1).pdf`。 */
  private uniqueImportedName(parentId: string | null, fileName: string): string {
    const base = sanitizeImportedName(fileName);
    const extension = path.extname(base);
    const stem = extension ? base.slice(0, -extension.length) : base;

    let candidate = base;
    let index = 1;
    while (this.resourceRepo.findChildByName(parentId, candidate)) {
      candidate = `${stem} (${index})${extension}`;
      index += 1;
    }
    return candidate;
  }

  /** 校验父目录：null 表示顶层，其余必须是已存在的文件夹。 */
  private assertParent(parentId: string | null): void {
    if (parentId === null) return;
    const parent = this.resourceRepo.findById(parentId);
    if (!parent || parent.kind !== 'folder') throw new DomainError('目标文件夹不存在');
  }

  /** 校验同级重名；`excludeId` 用于重命名与移动时排除自身。 */
  private assertNameAvailable(parentId: string | null, name: string, excludeId?: string): void {
    const existing = this.resourceRepo.findChildByName(parentId, name);
    if (existing && existing.id !== excludeId) throw new DomainError('同一目录下已存在同名条目');
  }

  /** 校验不会把目录移动进自己的子孙：从目标父目录向上找到根。 */
  private assertNotInside(id: string, targetParentId: string): void {
    let current: string | null = targetParentId;
    while (current !== null) {
      if (current === id) throw new DomainError('不能把文件夹移动到自己的子目录中');
      current = this.resourceRepo.findById(current)?.parentId ?? null;
    }
  }

  /** 读条目，不存在时抛出领域错误。 */
  private getEntity(id: string): ResourceEntity {
    const entity = this.resourceRepo.findById(id);
    if (!entity) throw new DomainError('资源不存在');
    return entity;
  }

  /** 文件格式是文件行的不变量，缺失说明数据损坏。 */
  private fileFormat(entity: ResourceEntity): ResourceFormat {
    if (entity.format === null) throw new DomainError('文件缺少格式信息');
    return entity.format;
  }

  /** 把一批行映射成渲染层 DTO，文件夹附带直接子项数。 */
  private toDtos(entities: ResourceEntity[]): ResourceDTO[] {
    const folderIds = entities.filter(entity => entity.kind === 'folder').map(entity => entity.id);
    const counts = folderIds.length > 0 ? this.resourceRepo.countChildrenByParents(folderIds) : {};
    return entities.map(entity =>
      this.toDto(entity, entity.kind === 'folder' ? (counts[entity.id] ?? 0) : null)
    );
  }

  /** 单条映射，文件夹附带直接子项数。 */
  private toDtoWithCounts(entity: ResourceEntity): ResourceDTO {
    if (entity.kind === 'file') return this.toDto(entity, null);
    const counts = this.resourceRepo.countChildrenByParents([entity.id]);
    return this.toDto(entity, counts[entity.id] ?? 0);
  }

  /** 把行映射成渲染层 DTO。 */
  private toDto(entity: ResourceEntity, childrenCount: number | null): ResourceDTO {
    return {
      id: entity.id,
      parentId: entity.parentId,
      kind: entity.kind,
      name: entity.name,
      format: entity.format,
      sizeBytes: entity.sizeBytes,
      lastOpenedAt: entity.lastOpenedAt,
      starred: entity.starred,
      childrenCount,
      url: entity.kind === 'file' ? `app:///resource/${entity.id}` : null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

/** 文件夹在前、同类按名称升序。 */
function sortByFolderThenName(items: readonly ResourceEntity[]): ResourceEntity[] {
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
}
