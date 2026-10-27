import { describe, expect, it } from 'vitest';
import type { DocParsingResult } from '@paddleocr/api-sdk';
import { parsePaddleResult, parseImageBox } from '../paddle/parser';
import { mergePageBlocks, type OcrTextBlock } from '../result';

/** 造一页服务端返回，`prunedResult` 是 unknown，直接给它块数组即可。 */
function page(list: Array<Record<string, unknown>>, images: Record<string, string> = {}) {
  return {
    markdownText: '',
    markdownImages: images,
    outputImages: {},
    prunedResult: { parsing_res_list: list },
  };
}

function result(pages: ReturnType<typeof page>[]): DocParsingResult {
  return { jobId: 'job-1', pages };
}

describe('parsePaddleResult', () => {
  it('按阅读顺序映射文字块，并丢弃页眉页脚页码', () => {
    const mapped = parsePaddleResult(
      result([
        page([
          { block_label: 'header', block_content: '书眉', block_bbox: [1, 1, 2, 2] },
          { block_label: 'paragraph_title', block_content: '标题', block_bbox: [1, 3, 2, 4] },
          { block_label: 'text', block_content: '正文', block_bbox: [1, 5, 2, 6] },
          { block_label: 'number', block_content: '12', block_bbox: [1, 7, 2, 8] },
          { block_label: 'footer', block_content: '页脚', block_bbox: [1, 9, 2, 10] },
        ]),
      ]),
      1
    );

    expect(mapped[0].blocks.map(block => block.type)).toEqual(['title', 'text']);
    expect(mapped[0].blocks.map(block => block.text)).toEqual(['标题', '正文']);
  });

  it('未知标签兜底成 text，空内容不产生块', () => {
    const mapped = parsePaddleResult(
      result([
        page([
          { block_label: 'brand_new_label', block_content: '新块', block_bbox: [0, 0, 1, 1] },
          { block_label: 'text', block_content: '   ', block_bbox: [0, 2, 1, 3] },
        ]),
      ]),
      1
    );

    expect(mapped[0].blocks).toHaveLength(1);
    expect(mapped[0].blocks[0]).toMatchObject({ type: 'text', text: '新块' });
  });

  it('绝对页号等于起始页加下标', () => {
    const mapped = parsePaddleResult(result([page([]), page([]), page([])]), 21);
    expect(mapped.map(item => item.page)).toEqual([21, 22, 23]);
  });

  it('从 markdownImages 里解析图片与坐标', () => {
    const mapped = parsePaddleResult(
      result([
        page([], { 'imgs/img_in_seal_box_352_336_497_541.jpg': 'https://example.com/a.jpg' }),
      ]),
      1
    );

    expect(mapped[0].images).toEqual([
      {
        name: 'imgs/img_in_seal_box_352_336_497_541.jpg',
        url: 'https://example.com/a.jpg',
        bbox: [352, 336, 497, 541],
      },
    ]);
  });

  it('解析不出坐标的图片 bbox 为 null', () => {
    expect(parseImageBox('imgs/a.jpg')).toBeNull();
    expect(parseImageBox('imgs/img_in_image_box_1_2_3_4.png')).toEqual([1, 2, 3, 4]);
  });
});

describe('mergePageBlocks', () => {
  const table: OcrTextBlock = { type: 'table', text: '<table/>', bbox: [100, 100, 700, 700] };
  const text1: OcrTextBlock = { type: 'text', text: '第一段', bbox: [100, 20, 700, 80] };
  const text2: OcrTextBlock = { type: 'text', text: '第二段', bbox: [100, 750, 700, 800] };

  it('表格里的插图插在表格块之后', () => {
    const merged = mergePageBlocks(
      [text1, table, text2],
      [{ bbox: [300, 300, 400, 400], attachmentId: 'attachment-1' }]
    );

    expect(merged.map(block => block.type)).toEqual(['text', 'table', 'image', 'text']);
    expect(merged[2]).toEqual({
      type: 'image',
      attachmentId: 'attachment-1',
      bbox: [300, 300, 400, 400],
    });
  });

  it('图片落在两块之间时按纵坐标插入', () => {
    const merged = mergePageBlocks(
      [text1, text2],
      [{ bbox: [100, 400, 200, 500], attachmentId: 'attachment-1' }]
    );

    expect(merged.map(block => block.type)).toEqual(['text', 'image', 'text']);
  });

  it('没有坐标的图片追加到页尾', () => {
    const merged = mergePageBlocks([text1], [{ bbox: null, attachmentId: 'attachment-1' }]);

    expect(merged.map(block => block.type)).toEqual(['text', 'image']);
  });

  it('落库的块保留坐标，文字块与图片块都有', () => {
    // 图片中心落在文字块内部，插在它之后
    const merged = mergePageBlocks([text1], [{ bbox: [200, 40, 300, 60], attachmentId: 'a' }]);

    expect(merged).toEqual([
      { type: 'text', text: '第一段', bbox: [100, 20, 700, 80] },
      { type: 'image', attachmentId: 'a', bbox: [200, 40, 300, 60] },
    ]);
  });

  it('没有坐标的块 bbox 存 null', () => {
    const merged = mergePageBlocks(
      [{ type: 'text', text: '无框', bbox: null }],
      [{ bbox: null, attachmentId: 'a' }]
    );

    expect(merged.map(block => block.bbox)).toEqual([null, null]);
  });
});
