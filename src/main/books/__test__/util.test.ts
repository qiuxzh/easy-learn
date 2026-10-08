import { describe, expect, it } from 'vitest';
import { initFoliatePolyfill } from '../foliate-polyfill';
import { extractSegmentText } from '../util';

/** 创建用于正文提取测试的 XHTML 文档。 */
function createDocument(content: string): Document {
  initFoliatePolyfill();
  return new DOMParser().parseFromString(
    '<html><body><p>' + content + '</p></body></html>',
    'application/xhtml+xml'
  );
}

describe('extractSegmentText', () => {
  it('会把行间 MathML 公式转换为 LaTeX', () => {
    const document = createDocument(
      '公式 <math display="block"><mfrac><mn>1</mn><mn>2</mn></mfrac></math> 用于检索。'
    );

    expect(extractSegmentText(document)).toContain('$$\\frac{1}{2}$$');
  });

  it('会优先使用 MathML 中已有的 TeX annotation', () => {
    const document = createDocument(
      '<math><semantics><mrow><mi>x</mi></mrow>' +
        '<annotation encoding="application/x-tex">\\alpha + \\beta</annotation>' +
        '</semantics></math>'
    );

    expect(extractSegmentText(document)).toContain('$\\alpha + \\beta$');
  });

  it('会跳过 head 与 svg 中的非正文文本', () => {
    initFoliatePolyfill();
    const document = new DOMParser().parseFromString(
      '<html><head><title>书名</title></head>' +
        '<body><svg><text>图形文字</text></svg><p>正文</p></body></html>',
      'application/xhtml+xml'
    );

    expect(extractSegmentText(document)).toBe('正文');
  });
});
