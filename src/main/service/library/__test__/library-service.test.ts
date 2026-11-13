import { describe, expect, it } from 'vitest';
import type { TransactionRunner } from '@main/contracts/transaction';
import type { LibraryFileStore } from '../library-storage';
import { LibraryService } from '../library-service';
import { PDF_DOC_META, createEntities, createRepo } from './resource-fixtures';

function createService(): LibraryService {
  const entities = createEntities();
  const docMeta = new Map<string, string>([['pdf1', PDF_DOC_META]]);
  const repo = createRepo(entities, docMeta);
  const storage = {
    importFile: () => {
      throw new Error('not used');
    },
    removeBlobs: () => undefined,
  } as LibraryFileStore;
  const transaction: TransactionRunner = fn => fn();

  return new LibraryService({ resourceRepo: repo, storage, transaction });
}

describe('LibraryService 资料列表', () => {
  it('浏览顶层：文件夹在前，带路径、子项数和已缓存的 PDF 页数', () => {
    const service = createService();
    const result = service.listResources({});

    expect(result.map(item => item.id)).toEqual(['f1', 'txt1', 'epub1']);

    const folder = result[0];
    expect(folder.kind).toBe('folder');
    expect(folder.path).toBe('线性代数');
    expect(folder.childrenCount).toBe(2);

    const pdf = service.listResources({ folderId: 'f1' }).find(item => item.id === 'pdf1');
    expect(pdf).toMatchObject({
      format: 'pdf',
      path: '线性代数/讲义.pdf',
      pageCount: 120,
      sectionCount: null,
    });
  });

  it('按名称搜索时限定在指定文件夹的子树内', () => {
    const service = createService();

    const all = service.listResources({ query: '笔记' });
    expect(all.map(item => item.id)).toEqual(['md1']);
    expect(all[0].path).toBe('线性代数/第一章/笔记.md');
    expect(all[0].starred).toBe(true);

    const scoped = service.listResources({ folderId: 'f2', query: '笔记' });
    expect(scoped.map(item => item.id)).toEqual(['md1']);

    const outside = service.listResources({ folderId: 'f1', query: '说明' });
    expect(outside).toEqual([]);
  });

  it('指定 format 时只返回文件，不返回文件夹', () => {
    const service = createService();
    const result = service.listResources({ folderId: 'f1', format: 'pdf' });

    expect(result.map(item => item.id)).toEqual(['pdf1']);
    expect(result.every(item => item.kind === 'file')).toBe(true);
  });

  it('递归按深度优先展开，返回全部匹配', () => {
    const service = createService();
    const result = service.listResources({ recursive: true });

    expect(result.map(item => item.id)).toEqual(['f1', 'f2', 'md1', 'pdf1', 'txt1', 'epub1']);
  });

  it('folderId 指向文件或不存在时抛出', () => {
    const service = createService();

    expect(() => service.listResources({ folderId: 'md1' })).toThrow('该 id 不是文件夹');
    expect(() => service.listResources({ folderId: 'missing' })).toThrow('文件夹不存在');
  });
});
