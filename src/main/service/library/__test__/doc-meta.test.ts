import { describe, expect, it } from 'vitest';
import {
  DOC_META_SCHEMA_VERSION,
  EPUB_STRUCTURE_PARSER_VERSION,
  type EpubDocMeta,
} from '@shared/types/library';
import { parseDocMeta, parseEpubDocMeta } from '../doc-meta';

const EPUB_META: EpubDocMeta = {
  format: 'epub',
  schemaVersion: DOC_META_SCHEMA_VERSION,
  parserVersion: EPUB_STRUCTURE_PARSER_VERSION,
  toc: [
    {
      id: '0',
      title: '第一章',
      level: 0,
      href: 'OEBPS/Text/ch1.xhtml',
      subitems: [{ id: '1', title: '第一节', level: 1 }],
    },
  ],
  sections: [
    {
      index: 0,
      href: 'OEBPS/Text/ch1.xhtml',
      title: '第一章',
      sizeBytes: 100,
      linear: true,
    },
  ],
};

describe('parseDocMeta EPUB', () => {
  it('解析当前版本的目录与 section 列表', () => {
    const meta = parseDocMeta(JSON.stringify(EPUB_META));
    expect(meta).toEqual(EPUB_META);
  });

  it('旧记录没有结构字段时按未解析处理', () => {
    const meta = parseDocMeta(
      JSON.stringify({ format: 'epub', schemaVersion: DOC_META_SCHEMA_VERSION })
    );

    expect(meta).toMatchObject({
      format: 'epub',
      toc: null,
      sections: null,
      parserVersion: 0,
    });
  });

  it('解析器版本不一致时目录与 section 一并作废', () => {
    const meta = parseDocMeta(
      JSON.stringify({ ...EPUB_META, parserVersion: EPUB_STRUCTURE_PARSER_VERSION + 1 })
    );

    expect(meta).toMatchObject({ toc: null, sections: null, parserVersion: 0 });
  });

  it('section 字段不合法时整份 section 缓存作废', () => {
    const meta = parseDocMeta(
      JSON.stringify({
        ...EPUB_META,
        sections: [{ index: 0, href: 'OEBPS/Text/ch1.xhtml', title: '第一章', linear: true }],
      })
    );

    expect(meta).toMatchObject({ sections: null });
  });

  it('parseEpubDocMeta 只接受 EPUB', () => {
    expect(
      parseEpubDocMeta(
        JSON.stringify({
          format: 'pdf',
          schemaVersion: DOC_META_SCHEMA_VERSION,
          pageCount: 1,
          hasTextLayer: true,
          toc: null,
          pageLabels: null,
        })
      )
    ).toBeNull();
  });
});
