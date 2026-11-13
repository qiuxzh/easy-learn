import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { ResourceEntity } from '@main/contracts/resource';
import type { ResourceRepo } from '@main/contracts/resource-repo';
import type { ResourceOcrPageRepo } from '@main/contracts/resource-ocr-repo';
import type { ResourceOcrPage } from '@main/contracts/resource-ocr';
import type { Paths } from '@main/paths';

export const PDF_DOC_META = JSON.stringify({
  format: 'pdf',
  schemaVersion: 1,
  pageCount: 120,
  hasTextLayer: true,
  toc: null,
  pageLabels: null,
});

/** 构造一条资料行；未指定的字段按普通 Markdown 文件补默认值。 */
export function resource(
  overrides: Partial<ResourceEntity> & Pick<ResourceEntity, 'id' | 'name'>
): ResourceEntity {
  return {
    parentId: null,
    kind: 'file',
    format: 'md',
    blobPath: null,
    sizeBytes: null,
    lastOpenedAt: null,
    starred: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** 固定的一组资料：两层文件夹、Markdown、PDF、EPUB、纯文本。 */
export function createEntities(): ResourceEntity[] {
  return [
    resource({ id: 'f1', name: '线性代数', kind: 'folder', format: null }),
    resource({ id: 'f2', name: '第一章', kind: 'folder', format: null, parentId: 'f1' }),
    resource({
      id: 'md1',
      name: '笔记.md',
      parentId: 'f2',
      blobPath: 'library/md-1.md',
      sizeBytes: 42,
      starred: true,
    }),
    resource({
      id: 'pdf1',
      name: '讲义.pdf',
      parentId: 'f1',
      format: 'pdf',
      blobPath: 'library/pdf-1.pdf',
      sizeBytes: 1024,
    }),
    resource({
      id: 'epub1',
      name: '验证书.epub',
      format: 'epub',
      blobPath: 'library/epub-1.epub',
      sizeBytes: 100,
    }),
    resource({
      id: 'txt1',
      name: '说明.txt',
      format: 'txt',
      blobPath: 'library/txt-1.txt',
      sizeBytes: 12,
    }),
  ];
}

/** 用固定行构造假仓储；docMeta 单独存一份，模拟回写。 */
export function createRepo(entities: ResourceEntity[], docMeta: Map<string, string>): ResourceRepo {
  return {
    create: () => {
      throw new Error('not used');
    },
    findById: id => entities.find(item => item.id === id),
    listChildren: parentId =>
      entities
        .filter(item => item.parentId === parentId)
        .sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
          return left.name < right.name ? -1 : 1;
        }),
    searchByName: query => entities.filter(item => item.name.includes(query)),
    countChildrenByParents: ids => {
      const result: Record<string, number> = {};
      for (const id of ids) result[id] = entities.filter(item => item.parentId === id).length;
      return result;
    },
    listStarredResources: () => entities.filter(item => item.starred),
    sumFileSize: () => 0,
    findChildByName: () => undefined,
    updateName: () => undefined,
    updateParent: () => undefined,
    findDocMeta: id => docMeta.get(id) ?? null,
    setDocMeta: (id, value) => {
      if (value === null) docMeta.delete(id);
      else docMeta.set(id, value);
    },
    setStarred: () => undefined,
    deleteByIds: () => undefined,
  };
}

export function createOcrRepo(pages: ResourceOcrPage[] = []): ResourceOcrPageRepo {
  return {
    listPageNumbers: () => pages.map(page => page.page),
    listPages: (_resourceId, requested) =>
      requested ? pages.filter(page => requested.includes(page.page)) : pages,
    countPages: () => pages.length,
    deletePages: () => undefined,
    insertMany: () => undefined,
  };
}

export function createTestPaths(rootDir: string): Paths {
  const dataDir = path.join(rootDir, 'data');
  const libraryDir = path.join(dataDir, 'library');
  return {
    dataDir,
    attachmentDir: path.join(dataDir, 'attachment'),
    booksDir: path.join(dataDir, 'books'),
    libraryDir,
    taskWorkDir: path.join(dataDir, 'task-work'),
    databasePath: path.join(dataDir, 'easy-learn.db'),
  };
}

/** 造一本两节、带 NAV 目录的 EPUB。 */
export function makeEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:verify</dc:identifier>
    <dc:title>验证书</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="Text/ch1.xhtml">第一章 起点</a></li>
  <li><a href="Text/ch2.xhtml">第二章 继续</a></li>
</ol></nav></body></html>`
  );
  zip.file(
    'OEBPS/Text/ch1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 起点</title></head>
<body><h1>第一章 起点</h1><p>第一章正文。</p></body></html>`
  );
  zip.file(
    'OEBPS/Text/ch2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 继续</title></head>
<body><h1>第二章 继续</h1><p>第二章正文。</p></body></html>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** 准备资料读取测试要用的源文件。 */
export async function prepareLibraryFiles(paths: Paths): Promise<void> {
  fs.mkdirSync(paths.libraryDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.libraryDir, 'md-1.md'),
    '# 标题\r\n\r\n第一段。\r\n第二段。\r\n'
  );
  fs.writeFileSync(path.join(paths.libraryDir, 'txt-1.txt'), '纯文本内容。\n');
  fs.writeFileSync(path.join(paths.libraryDir, 'epub-1.epub'), await makeEpub());
}
