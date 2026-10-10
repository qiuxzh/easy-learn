import { Type } from 'typebox';
import { defineSessionTool } from '@main/agent/common-agent/agent-definition';
import { searchBookBm25, searchBookVector } from '@main/books/book-retrieval';
import {
  bookService,
  DEFAULT_READ_LENGTH,
  DEFAULT_READ_OFFSET,
  MAX_READ_LENGTH,
} from '@main/books/book-service';
import { readingService } from '@main/service/reading-service';

/**
 * 本文件工具的结果统一以 JSON 文本交给模型，details 一律不提供：
 * 界面只读 content，没有消费方，给了等于随会话日志白存一份。
 * 将来界面确实要渲染某类结构化数据时，再单独给对应工具加 details。
 */

/** 书的目录：按 bookId 返回嵌套的 TOCItem 树。 */
const getBookTocsTool = defineSessionTool({
  name: 'get_book_tocs',
  description:
    '根据书的 id 获取该书的完整目录（嵌套结构，含 id、层级、子章节、href 等），用于回答用户关于书籍章节结构的问题',
  promptSnippet: '查看某本书的目录结构',
  promptGuidelines: [
    '检索返回的片段不足以回答时，用 get_book_tocs 查看目录结构，再用 read_book_toc_text 读整章。',
  ],
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
  }),
  async execute(_toolCallId, params) {
    const tocs = await bookService.getBookTocs(params.bookId);

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
    '可使用 offset 和 length 分段读取；返回 truncated 为 true 时表示后面还有正文。',
  promptSnippet: '读取某个章节的正文',
  promptGuidelines: [
    '调用 read_book_toc_text 之前需要确保调用过 get_book_tocs 获取目录结构（含 id），否则无法获取到 tocId',
    'read_book_toc_text 返回 truncated=true 时，把当前 offset（未传时按 0）加上已返回文本长度，作为新的 offset 继续读取后续内容。',
  ],
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
        description: `可选，本次返回文本的最大字符数，默认 ${DEFAULT_READ_LENGTH}，最大 ${MAX_READ_LENGTH}`,
      })
    ),
  }),
  async execute(_toolCallId, params) {
    const result = await bookService.readBookTocText(
      params.bookId,
      params.tocId,
      params.offset,
      params.length
    );

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
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
  promptGuidelines: ['需要术语、人名、专有名词等字面匹配时，用 search_book_bm25 在指定书里检索。'],
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
  promptGuidelines: [
    '给不出准确关键词、或问法与书中用词不一致时，用 search_book_vector 做语义检索。',
  ],
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
    '获取用户最近一次同步到主进程的阅读状态，包含当前书籍、目录 tocId、章节标题、章节 href 和阅读进度。',
  promptSnippet: '获取用户当前阅读状态',
  promptGuidelines: [
    '不确定用户说的是哪本书时，先调用 get_user_reading_state 看当前的阅读状态。',
    'get_user_reading_state 获取的信息可能不是最新的，你需要重新调用来获取最新的',
    '先调用 get_user_reading_state 获取tocId，再使用 read_book_toc_text 可以阅读到用户正在阅读的整个章节',
  ],
  parameters: Type.Object({}),
  async execute() {
    const state = readingService.getCurrentReadingState();
    if (!state) {
      // 用户尚未同步过状态，把"没有"讲清楚，避免模型把它当成读取失败
      return {
        content: [{ type: 'text' as const, text: '用户当前没有阅读状态，尚未同步过阅读进度。' }],
        details: undefined,
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(state) }],
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
];
