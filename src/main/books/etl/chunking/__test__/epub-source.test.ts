import { describe, expect, it } from 'vitest';
import type { FoliateBook, FoliateSection } from '@/components/reader/foliate-types';
import { initFoliatePolyfill } from '../../../foliate-polyfill';
import { chunkDocument } from '../chunk-document';
import { DEFAULT_CHUNK_OPTIONS } from '../splitter';
import { createEpubSource } from '../epub-source';
import type { ChunkDraft } from '../types';

/** 创建指定 body 内容的 XHTML 文档。 */
function createDocument(body: string): Document {
  initFoliatePolyfill();
  return new DOMParser().parseFromString(
    `<html><body>${body}</body></html>`,
    'application/xhtml+xml'
  );
}

/** 创建只包含指定 section 的测试书籍。 */
function createBookFromSections(sections: FoliateSection[]): FoliateBook {
  return {
    metadata: {},
    sections,
  };
}

/** 创建可解析的测试 section。 */
function createSection(id: string, body: string, cfi = `epubcfi(/6/2[${id}])`): FoliateSection {
  return {
    id,
    cfi,
    load: () => '',
    createDocument: () => createDocument(body),
  };
}

/** 创建由单个段落组成的测试书籍。 */
function createBook(content: string): FoliateBook {
  return createBookFromSections([createSection('chapter-1.xhtml', `<p>${content}</p>`)]);
}

/** 创建由原始 body 内容组成的测试书籍。 */
function createBookFromMarkup(markup: string): FoliateBook {
  return createBookFromSections([createSection('chapter-1.xhtml', markup)]);
}

/** 生成带稳定句末边界的长正文。 */
function createLongContent(): string {
  return Array.from(
    { length: 80 },
    (_, index) => `第${index + 1}段包含用于验证重叠切分的正文内容。`
  ).join('');
}

/** 按 EPUB 文档源切分一本书。 */
function chunkBook(book: FoliateBook): Promise<ChunkDraft[]> {
  return chunkDocument(createEpubSource(book), DEFAULT_CHUNK_OPTIONS);
}

describe('chunkDocument + createEpubSource', () => {
  it('会为长正文生成符合长度要求且带 CFI 的重叠分片', async () => {
    const chunks = await chunkBook(createBook(createLongContent()));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.slice(0, -1).every(chunk => chunk.content.length >= 300)).toBe(true);
    expect(chunks.every(chunk => chunk.content.length <= 800)).toBe(true);
    expect(chunks[0].content.slice(-120)).toBe(chunks[1].content.slice(0, 120));
    expect(chunks[0].locatorStart).toMatch(/^epubcfi\(/);
    expect(chunks[0].locatorEnd).toMatch(/^epubcfi\(/);
  });

  it('会保留检索和跳转所需的全部字段', async () => {
    const chunks = await chunkBook(createBook('这是一段不足三百字的简短正文。'));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      segmentIndex: 0,
      segmentId: 'chapter-1.xhtml',
      chunkIndex: 0,
      content: '这是一段不足三百字的简短正文。',
    });
  });

  it('会压缩连续空白并保留块级元素边界', async () => {
    const chunks = await chunkBook(
      createBookFromMarkup('<p>第一段   内容</p><div>第二段\t内容</div><p>第三段</p>')
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('第一段 内容\n第二段 内容\n第三段');
  });

  it('会跳过不可检索标签及其后代文本', async () => {
    const chunks = await chunkBook(
      createBookFromMarkup(
        '<p>保留前文</p>' +
          '<script>alert("忽略脚本")</script>' +
          '<style>.ignored { color: red; }</style>' +
          '<svg><text>忽略 SVG</text></svg>' +
          '<canvas>忽略 Canvas</canvas>' +
          '<p>保留后文</p>'
      )
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('保留前文\n保留后文');
  });

  it('整节只有空白或图片时不生成空 Chunk', async () => {
    const chunks = await chunkBook(
      createBookFromMarkup('<p> \n\t </p><img src="cover.jpg" alt="封面"/>')
    );

    expect(chunks).toEqual([]);
  });

  it('会按 section 独立编号并保留各自的 CFI', async () => {
    const chunks = await chunkBook(
      createBookFromSections([
        createSection('chapter-1.xhtml', '<p>第一章</p>', 'epubcfi(/6/2[chapter-1])'),
        createSection('chapter-2.xhtml', '<p>第二章</p>', 'epubcfi(/6/4[chapter-2])'),
      ])
    );

    expect(chunks).toHaveLength(2);
    expect(chunks).toMatchObject([
      {
        segmentIndex: 0,
        segmentId: 'chapter-1.xhtml',
        content: '第一章',
      },
      {
        segmentIndex: 1,
        segmentId: 'chapter-2.xhtml',
        content: '第二章',
      },
    ]);
    expect(chunks[0].locatorStart).toContain('[chapter-1]');
    expect(chunks[1].locatorStart).toContain('[chapter-2]');
  });

  it('会跳过没有 createDocument 的 section', async () => {
    const chunks = await chunkBook(
      createBookFromSections([
        {
          id: 'skipped.xhtml',
          cfi: 'epubcfi(/6/2[skipped])',
          load: () => '',
        },
        createSection('chapter-1.xhtml', '<p>可见正文。</p>'),
      ])
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      segmentIndex: 1,
      segmentId: 'chapter-1.xhtml',
      content: '可见正文。',
    });
  });

  it('section 缺少 CFI 时降级为节级兜底定位', async () => {
    const book = createBook('正文');
    delete book.sections[0].cfi;

    const chunks = await chunkBook(book);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('正文');
    expect(chunks[0].locatorStart).toBe('epubsec:0');
    expect(chunks[0].locatorEnd).toBe('epubsec:0');
  });

  it('会优先在目标长度前的句末边界结束 Chunk', async () => {
    const firstSentence = '甲'.repeat(550) + '。';
    const chunks = await chunkBook(createBook(firstSentence + '乙'.repeat(300) + '。'));

    expect(chunks[0].content).toBe(firstSentence);
  });

  it('会将块级 MathML 公式与相邻正文分行输出', async () => {
    const chunks = await chunkBook(
      createBook('前文 <math display="block"><mfrac><mn>1</mn><mn>2</mn></mfrac></math> 后文')
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('前文\n$$\\frac{1}{2}$$\n后文');
  });

  it('会将行内 MathML 公式转换为 LaTeX 且不重复输出公式字符', async () => {
    const chunks = await chunkBook(
      createBook('设 <math><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></math> 为未知数')
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('设 $x + y$ 为未知数');
  });

  it('会去掉 TeX annotation 自带的外层定界符', async () => {
    const chunks = await chunkBook(
      createBook(
        '<math><semantics><mrow><mi>x</mi></mrow>' +
          '<annotation encoding="application/x-tex">$$\\alpha + \\beta$$</annotation>' +
          '</semantics></math>'
      )
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('$\\alpha + \\beta$');
  });

  it('只有无法提取内容的公式时不生成 Chunk', async () => {
    const chunks = await chunkBook(createBook('<math></math>'));

    expect(chunks).toEqual([]);
  });
});
