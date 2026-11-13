import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResourceOcrPage } from '@main/contracts/resource-ocr';
import type { AttachmentService } from '@main/service/attachment-service';
import type { Paths } from '@main/paths';
import {
  PDF_DOC_META,
  createEntities,
  createOcrRepo,
  createRepo,
  createTestPaths,
  prepareLibraryFiles,
} from './resource-fixtures';
import { ResourceReaderService } from '../resource-reader-service';

let rootDir: string;
let paths: Paths;

function createService(ocrPages: ResourceOcrPage[] = []): {
  service: ResourceReaderService;
  docMeta: Map<string, string>;
} {
  const entities = createEntities();
  const docMeta = new Map<string, string>([['pdf1', PDF_DOC_META]]);
  const repo = createRepo(entities, docMeta);
  const attachmentService = { storeImages: async () => [] } as unknown as AttachmentService;

  return {
    service: new ResourceReaderService({
      paths,
      resourceRepo: repo,
      ocrPageRepo: createOcrRepo(ocrPages),
      attachmentService,
    }),
    docMeta,
  };
}

beforeAll(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-resource-reader-test-'));
  paths = createTestPaths(rootDir);
  await prepareLibraryFiles(paths);
});

afterAll(() => {
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('ResourceReaderService 文本读取', () => {
  it('Markdown 原样读取完整正文', async () => {
    const { service } = createService();
    const result = await service.readTextResource('md1');

    expect(result.text).toBe('# 标题\n\n第一段。\n第二段。\n');
  });

  it('纯文本统一换行后返回完整正文', async () => {
    const { service } = createService();
    const result = await service.readTextResource('txt1');

    expect(result.text).toBe('纯文本内容。\n');
  });

  it('非 Markdown/纯文本格式拒绝读取', async () => {
    const { service } = createService();
    await expect(service.readTextResource('epub1')).rejects.toThrow('不是 Markdown 或纯文本');
  });
});

describe('ResourceReaderService PDF OCR', () => {
  it('只返回已有 OCR 的页，并标出缺失页', async () => {
    const { service } = createService([
      { page: 1, blocks: [{ type: 'text', text: 'OCR 第一页', bbox: null }] },
    ]);
    const result = await service.readPdfPageOcrText('pdf1', 1, 2);

    expect(result.pageCount).toBe(120);
    expect(result.pages).toEqual([
      { page: 1, text: 'OCR 第一页' },
      { page: 2, text: '' },
    ]);
    expect(result.missingPages).toEqual([2]);
  });

  it('页码超出范围时拒绝', async () => {
    const { service } = createService();
    await expect(service.readPdfPageOcrText('pdf1', 121)).rejects.toThrow('页码超出范围');
  });
});

describe('ResourceReaderService EPUB', () => {
  it('返回目录与 section 列表，并把目录项映射到 section 下标', async () => {
    const { service, docMeta } = createService();
    const result = await service.readEpubToc('epub1');

    expect(result.hasToc).toBe(true);
    expect(result.sectionCount).toBe(2);
    expect(result.sections.map(section => section.title)).toEqual(['第一章 起点', '第二章 继续']);
    expect(result.toc.map(item => item.sectionIndex)).toEqual([0, 1]);
    expect(result.sections[0].tocTitle).toBe('第一章 起点');
    expect(docMeta.has('epub1')).toBe(true);
  });

  it('按 sectionIndex 读取正文，并给出前后节下标', async () => {
    const { service } = createService();
    const result = await service.readEpubSection('epub1', 0);

    expect(result.title).toBe('第一章 起点');
    expect(result.text).toContain('第一章正文');
    expect(result.nextSectionIndex).toBe(1);
    expect(result.prevSectionIndex).toBeNull();
  });

  it('sectionIndex 越界时拒绝', async () => {
    const { service } = createService();
    await expect(service.readEpubSection('epub1', 2)).rejects.toThrow('sectionIndex 越界');
  });
});
