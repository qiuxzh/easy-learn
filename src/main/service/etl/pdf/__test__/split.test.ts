import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { splitPdf } from '../split';

let workDir: string | null = null;

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

/** 生成一份指定页数的空白 PDF。 */
async function createPdf(pageCount: number, filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([200, 300]);
  }
  await writeFile(filePath, await document.save());
}

describe('splitPdf', () => {
  it('按页数切成连续的块，页序与页数都正确', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'split-pdf-'));
    const source = path.join(workDir, 'source.pdf');
    await createPdf(5, source);

    const { pageCount, chunks } = await splitPdf(source, 2, path.join(workDir, 'chunks'));

    expect(pageCount).toBe(5);
    expect(chunks.map(chunk => [chunk.start, chunk.end])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);

    for (const chunk of chunks) {
      const document = await PDFDocument.load(await readFile(chunk.filePath));
      expect(document.getPageCount()).toBe(chunk.end - chunk.start + 1);
    }
  });

  it('页数不足一块时只产出一个块', async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'split-pdf-'));
    const source = path.join(workDir, 'source.pdf');
    await createPdf(3, source);

    const { chunks } = await splitPdf(source, 20, path.join(workDir, 'chunks'));

    expect(chunks).toHaveLength(1);
    expect([chunks[0].start, chunks[0].end]).toEqual([1, 3]);
  });
});
