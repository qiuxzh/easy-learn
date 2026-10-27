import { Type } from 'typebox';
import { defineSessionTool } from '@main/agent/common-agent/agent-definition';
import { searchBookBm25, searchBookVector } from '@main/books/book-retrieval';
import {
  getBookTocs,
  readBookImage,
  readBookTocText,
  DEFAULT_READ_LENGTH,
  DEFAULT_READ_OFFSET,
  MAX_READ_LENGTH,
  readPdfPageImage,
  readPdfPageText,
} from '@main/books/book-reader';
import { readingService } from '@main/service/reading-service';

/** 书的目录：按 bookId 返回嵌套的 TOCItem 树。 */
const getBookTocsTool = defineSessionTool({
  name: 'get_book_tocs',
  description:
    '根据书的 id 获取该书的完整目录（嵌套结构，含 id、层级、子章节、href 等），用于回答用户关于书籍章节结构的问题',
  promptSnippet: '查看某本书的目录结构',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
  }),
  async execute(_toolCallId, params) {
    const tocs = await getBookTocs(params.bookId);

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tocs) }],
      details: undefined,
    };
  },
});

/** 章节正文：按 tocId 读取该目录项自己的正文范围（到下一个同级或更高层目录项之前为止）。 */
const readBookTocTextTool = defineSessionTool({
  name: 'read_book_toc_text',
  description:
    '根据书的 id 和目录 toc id 读取该目录项对应的正文，范围从该目录项开头到下一个同级或更高层目录项之前。' +
    '可使用 offset 和 length 分段读取。返回 JSON，含 text、offset、length、totalChars、truncated、nextOffset 等字段（totalChars 无法确定时为 null）；' +
    'truncated=true 时直接用 nextOffset 继续读取；truncated=false 表示已到该目录项末尾，不代表全书读完。失败时 error 字段说明原因。',
  promptSnippet: '读取某个章节的正文',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    tocId: Type.String({ minLength: 1, description: '目录项的 id，由 get_book_tocs 返回' }),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: `可选，从章节正文第几个字符开始读取（从 0 开始），默认 ${DEFAULT_READ_OFFSET}`,
      })
    ),
    length: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_READ_LENGTH,
        description: `可选，本次最多返回的字符数，默认 ${DEFAULT_READ_LENGTH}，最大 ${MAX_READ_LENGTH}；实际生效值见返回的 length`,
      })
    ),
  }),
  async execute(_toolCallId, params) {
    const result = await readBookTocText(params.bookId, params.tocId, params.offset, params.length);

    if (!result.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: undefined,
      };
    }

    const offset = params.offset ?? DEFAULT_READ_OFFSET;
    const length = params.length ?? DEFAULT_READ_LENGTH;
    const returnedChars = result.text.length;
    const nextOffset = result.truncated ? offset + returnedChars : null;
    // offset 大于 0 且窗口为空时，service 分不清「刚好到本章末尾」和「offset 越界」，
    // 两种情况 truncatedChars 都是 0，拿不到真实总长。
    const totalChars =
      returnedChars > 0 || result.truncatedChars > 0 || offset === 0
        ? offset + returnedChars + result.truncatedChars
        : null;

    const payload = {
      ...result,
      offset,
      length,
      totalChars,
      nextOffset,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      details: undefined,
    };
  },
});

/** 关键词检索：字面命中片段，附带可直接跳转阅读器的定位串。 */
const searchBookBm25Tool = defineSessionTool({
  name: 'search_book_bm25',

  description:
    '根据关键词在指定书籍的正文中做字面检索。返回片段正文、分数（越大越相关）' +
    '适合术语、人名、专有名词这类能给出准确关键词的查询；如片段不足，再调用 read_book_toc_text 阅读完整章节。',
  promptSnippet: '按关键词在指定书中检索正文片段',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    query: Type.String({ minLength: 1, description: '需要检索的关键词或问题' }),
    topK: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10, description: '最多返回的结果数，默认 5' })
    ),
  }),
  async execute(_toolCallId, params) {
    const hits = await searchBookBm25(params.bookId, params.query, params.topK ?? 5);

    const payload = {
      bookId: params.bookId,
      query: params.query,
      totalResults: hits.length,
      results: hits,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      details: undefined,
    };
  },
});

/** 语义检索：问法与原文用词不一致时靠它，字面检索靠 bm25。 */
const searchBookVectorTool = defineSessionTool({
  name: 'search_book_vector',
  description:
    '根据问题或描述在指定书籍的正文中做语义检索。返回片段正文、相似度分数（越大越相关，最大是1）',
  promptSnippet: '按语义在指定书中检索正文片段',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    query: Type.String({ minLength: 1, description: '需要检索的问题或描述' }),
    topK: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10, description: '最多返回的结果数，默认 5' })
    ),
  }),
  async execute(_toolCallId, params) {
    const result = await searchBookVector(params.bookId, params.query, params.topK ?? 5);

    if (!result.ok) {
      return {
        content: [{ type: 'text' as const, text: `检索失败：${result.message}` }],
        details: undefined,
      };
    }

    const payload = {
      bookId: params.bookId,
      query: params.query,
      status: 'ok',
      totalResults: result.hits.length,
      results: result.hits,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      details: undefined,
    };
  },
});

/** 阅读状态：用户最近一次同步到主进程的进度，可据此拿到当前章节的 tocId。 */
const getUserReadingStateTool = defineSessionTool({
  name: 'get_user_reading_state',
  description:
    '获取用户最近一次同步到主进程的阅读状态。PDF 返回当前物理页码与总页数；EPUB 返回目录 tocId、章节标题、章节 href 与阅读进度。',
  promptSnippet: '获取用户当前阅读状态',
  promptGuidelines: ['不确定用户在看哪本书时，先查阅读状态。'],
  parameters: Type.Object({}),
  async execute() {
    const state = readingService.getCurrentReadingState();
    if (!state) {
      // 用户尚未同步过状态，把"没有"讲清楚，避免模型把它当成读取失败
      return {
        content: [{ type: 'text' as const, text: '用户并没有阅读状态' }],
        details: undefined,
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(state) }],
      details: undefined,
    };
  },
});

/** 书内图片：按正文占位里的 bookImage key 读取图片，登记为新附件后交给模型查看。 */
const readBookImageTool = defineSessionTool({
  name: 'read_book_image',
  description:
    '按书内资源 key 读取书籍里的图片，把图片本身交给模型查看。key 见正文中标注的 bookImage:{key}。',
  promptSnippet: '根据书内资源 key 查看书籍图片',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    resourceKey: Type.String({ description: '图片在书内的资源 key，取自正文中的 bookImage:{key}' }),
  }),
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error('操作已取消');
    }

    const stored = await readBookImage(params.bookId, params.resourceKey);
    return {
      content: [
        { type: 'text' as const, text: `读取书籍图片：${params.resourceKey}` },
        { type: 'image' as const, attachmentId: stored.attachmentId },
      ],
      details: undefined,
    };
  },
});

/** read_pdf_page_text 单次最多返回的页数；超出部分由调用方换 startPage 再读。 */
const MAX_PDF_TEXT_PAGES = 10;

/** 按页范围读取 PDF 文本层；页码是物理页号，与 `pdf:<页>` 定位串一致。 */
const readPdfPageTextTool = defineSessionTool({
  name: 'read_pdf_page_text',
  description:
    `按物理页码读取 PDF 文本层（从 1 开始，页码与检索结果里的 pdf:<页> 一致）。` +
    `单次最多读 ${MAX_PDF_TEXT_PAGES} 页，超出部分用新的 startPage 再读。` +
    '文本层为空的页会回退到已完成的 OCR 结果。',
  promptSnippet: '按页码读取 PDF 的正文文字',
  promptGuidelines: [
    'PDF 用 read_pdf_page_text / read_pdf_page_image；EPUB 用 get_book_tocs / read_book_toc_text。',
  ],
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    startPage: Type.Integer({ minimum: 1, description: '起始物理页号，从 1 开始' }),
    endPage: Type.Optional(
      Type.Integer({ minimum: 1, description: '结束物理页号（含），省略时只读 startPage 这一页' })
    ),
  }),
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error('操作已取消');
    }

    const endPage = Math.min(
      params.endPage ?? params.startPage,
      params.startPage + MAX_PDF_TEXT_PAGES - 1
    );
    const result = await readPdfPageText(params.bookId, params.startPage, endPage);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      details: undefined,
    };
  },
});

/** 把 PDF 的一页渲染成图片交给模型；单页限制避免一次拉高请求体积与上下文占用。 */
const readPdfPageImageTool = defineSessionTool({
  name: 'read_pdf_page_image',
  description:
    '按物理页码把 PDF 的一页渲染成图片并给大模型查看（从 1 开始，单次只能读一页）。' +
    '只有文字工具读不到内容，或需要确认版面、图表、公式时，才用 read_pdf_page_image。',
  promptSnippet: '按页码查看 PDF 某一页的页面图',
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    page: Type.Integer({ minimum: 1, description: '物理页号，从 1 开始' }),
  }),
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error('操作已取消');
    }

    const result = await readPdfPageImage(params.bookId, params.page);
    return {
      content: [
        {
          type: 'text' as const,
          text: `PDF 第 ${result.page} 页页面图（共 ${result.pageCount} 页）`,
        },
        result.image,
      ],
      details: undefined,
    };
  },
});

/** 阅读智能体可用的全部工具。 */
export const readingTools = [
  getBookTocsTool,
  readBookTocTextTool,
  searchBookBm25Tool,
  searchBookVectorTool,
  getUserReadingStateTool,
  readBookImageTool,
  readPdfPageTextTool,
  readPdfPageImageTool,
];
