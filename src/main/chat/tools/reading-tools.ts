import { Type } from 'typebox';
import { defineSessionTool } from '@main/agent/common-agent/agent-definition';
import { BookBm25SearchResult, bookBm25SearchService } from '@main/books/book-bm25';
import {
  bookService,
  DEFAULT_READ_SECTION_LENGTH,
  DEFAULT_READ_SECTION_OFFSET,
  MAX_READ_SECTION_LENGTH,
} from '@main/books/book-service';
import { readingService } from '@main/service/reading-service';

/**
 * 本文件工具的结果统一以 JSON 文本交给模型，details 一律不提供：
 * 界面只读 content，没有消费方，给了等于随会话日志白存一份。
 * 将来界面确实要渲染某类结构化数据时，再单独给对应工具加 details。
 */

/** 将 BM25 命中结果限制在 AI 工具的 5,000 字符上下文预算内。 */
function limitBm25ToolContext(searchResults: BookBm25SearchResult[]) {
  const maxTotalCharacters = 5000;
  const results: Array<{
    id: string;
    score: number;
    sectionIndex: number;
    sectionId: string;
    href: string;
    chunkIndex: number;
    startCfi: string;
    endCfi: string;
    content: string;
    truncated: boolean;
  }> = [];
  let totalCharacters = 0;

  for (const { chunk, score } of searchResults) {
    const remainingCharacters = maxTotalCharacters - totalCharacters;
    if (remainingCharacters <= 0) break;

    const content = chunk.content.slice(0, remainingCharacters);
    results.push({
      id: chunk.id,
      score: Math.round(score * 1000) / 1000,
      sectionIndex: chunk.sectionIndex,
      sectionId: chunk.sectionId,
      href: chunk.href,
      chunkIndex: chunk.chunkIndex,
      startCfi: chunk.startCfi,
      endCfi: chunk.endCfi,
      content,
      truncated: content.length < chunk.content.length,
    });
    totalCharacters += content.length;
  }

  return results;
}

/** 书的目录：按 bookId 返回嵌套的 TOCItem 树。 */
const getBookTocsTool = defineSessionTool({
  name: 'get_book_tocs',
  label: '读取目录',
  description:
    '根据书的 id 获取该书的完整目录（嵌套结构，含 id、层级、子章节、href 等），用于回答用户关于书籍章节结构的问题',
  promptSnippet: '查看某本书的目录结构',
  promptGuidelines: [
    'search_book_bm25 返回的片段不足以回答时，用 get_book_tocs 查看目录结构，再用 read_book_toc_section 读整章。',
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
const readBookTocSectionTool = defineSessionTool({
  name: 'read_book_toc_section',
  label: '读取章节',
  description:
    '根据书的 id 和目录 toc id 读取该目录项对应的正文，范围从该目录项开头到下一个同级或更高层目录项之前。' +
    '可使用 offset 和 length 分段读取；返回 truncated 为 true 时表示后面还有正文。',
  promptSnippet: '读取某个章节的正文',
  promptGuidelines: [
    '调用 read_book_toc_section 之前需要确保调用过 get_book_tocs 获取目录结构（含 id），否则无法获取到 tocId',
    'read_book_toc_section 返回 truncated=true 时，把当前 offset（未传时按 0）加上已返回文本长度，作为新的 offset 继续读取后续内容。',
  ],
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    tocId: Type.String({ minLength: 1, description: '目录项的 id，由 get_book_tocs 返回' }),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: `可选，从章节正文第几个字符开始读取（从 0 开始），默认 ${DEFAULT_READ_SECTION_OFFSET}`,
      })
    ),
    length: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_READ_SECTION_LENGTH,
        description: `可选，本次返回文本的最大字符数，默认 ${DEFAULT_READ_SECTION_LENGTH}，最大 ${MAX_READ_SECTION_LENGTH}`,
      })
    ),
  }),
  async execute(_toolCallId, params) {
    const result = await bookService.readBookTocSection(
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

/** 正文检索：关键词命中片段，附带可直接跳转阅读器的 CFI。 */
const searchBookBm25Tool = defineSessionTool({
  name: 'search_book_bm25',
  label: '检索书中内容',
  description:
    '根据关键词或问题在指定书籍的正文中检索最相关的片段。返回片段正文、BM25 分数和 startCfi。' +
    '回答书中具体内容前，应优先调用此工具定位相关段落；如片段不足，再调用 read_book_toc_section 阅读完整章节。',
  promptSnippet: '在指定书中检索正文片段',
  promptGuidelines: [
    '回答与书中内容有关的问题时，先用 search_book_bm25 在指定书里检索，定位到相关段落后再作答。',
  ],
  parameters: Type.Object({
    bookId: Type.String({ minLength: 1, description: '书的 id' }),
    query: Type.String({ minLength: 1, description: '需要检索的关键词或问题' }),
    topK: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 10, description: '最多返回的结果数，默认 5' })
    ),
  }),
  async execute(_toolCallId, params) {
    const searchResults = await bookBm25SearchService.search(
      params.bookId,
      params.query,
      params.topK ?? 5
    );
    const results = limitBm25ToolContext(searchResults);

    const payload = {
      bookId: params.bookId,
      query: params.query,
      totalResults: searchResults.length,
      returnedResults: results.length,
      totalCharacters: results.reduce((total, result) => total + result.content.length, 0),
      results,
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
  label: '获取阅读状态',
  description:
    '获取用户最近一次同步到主进程的阅读状态，包含当前书籍、目录 tocId、章节标题、章节 href 和阅读进度。',
  promptSnippet: '获取用户当前阅读状态',
  promptGuidelines: [
    '不确定用户说的是哪本书时，先调用 get_user_reading_state 看当前的阅读状态。',
    'get_user_reading_state 获取的信息可能不是最新的，你需要重新调用来获取最新的',
    '先调用 get_user_reading_state 获取tocId，再使用 read_book_toc_section 可以阅读到用户正在阅读的整个章节',
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
  readBookTocSectionTool,
  searchBookBm25Tool,
  getUserReadingStateTool,
];
