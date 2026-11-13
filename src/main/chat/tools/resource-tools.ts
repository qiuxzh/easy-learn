import { Type } from 'typebox';
import { defineSessionTool, type SessionTool } from '@main/agent/common-agent/agent-definition';
import {
  DEFAULT_TEXT_LENGTH,
  MAX_TEXT_LENGTH,
  sliceTextWindow,
} from '@main/agent/common-agent/util/truncate';
import { toTsv } from '@main/agent/common-agent/util/tsv';
import type { LibraryService } from '@main/service/library/library-service';
import {
  MAX_PDF_PAGES_PER_READ,
  type ResourceReaderService,
} from '@main/service/library/resource-reader-service';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/** 资料列表的简表列。 */
const BRIEF_COLUMNS = ['id', 'name', 'kind', 'format', 'sizeBytes'] as const;

/** 完整列表在简表后追加的列。 */
const DETAIL_COLUMNS = [
  ...BRIEF_COLUMNS,
  'starred',
  'childrenCount',
  'pageCount',
  'sectionCount',
  'folderId',
  'path',
] as const;

export interface ResourceToolDeps {
  libraryService: LibraryService;
  resourceReaderService: ResourceReaderService;
}

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}

function plainTextResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: undefined,
  };
}

/** 资料格式的闭集。 */
const RESOURCE_FORMAT = Type.Union([
  Type.Literal('pdf'),
  Type.Literal('epub'),
  Type.Literal('md'),
  Type.Literal('txt'),
]);

/** 正文读取的公共参数。 */
const READ_OFFSET = Type.Optional(
  Type.Integer({ minimum: 0, description: '从第几个字符开始读取，默认 0' })
);
const READ_LENGTH = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: MAX_TEXT_LENGTH,
    description: `本次最多返回的字符数，默认 ${DEFAULT_TEXT_LENGTH}，最大 ${MAX_TEXT_LENGTH}`,
  })
);

export function createResourceTools(deps: ResourceToolDeps): SessionTool[] {
  const listTool = defineSessionTool({
    name: 'resource_list',
    description:
      '查看资料库里的文件和文件夹，可按名称搜索。返回 TSV 表格；默认简表，detail=true 返回完整字段。',
    promptSnippet: '查看资料库列表',
    promptGuidelines: [
      '用户没给资料 id 时先用 resource_list 查找；需要页数、路径等完整字段时传 detail=true。',
      '列表被截断时用 offset 翻页；长文档用 offset 续读。',
    ],
    parameters: Type.Object({
      folderId: Type.Optional(
        Type.String({ minLength: 1, description: '文件夹 id；省略时看资料库顶层' })
      ),
      query: Type.Optional(
        Type.String({ minLength: 1, description: '按名称搜索；省略时浏览文件夹' })
      ),
      format: Type.Optional(RESOURCE_FORMAT),
      recursive: Type.Optional(Type.Boolean({ description: '浏览时是否包含子文件夹，默认 false' })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: '跳过前多少条，用于翻页' })),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `最多返回多少条，默认 ${DEFAULT_LIST_LIMIT}`,
        })
      ),
      detail: Type.Optional(Type.Boolean({ description: '是否返回完整字段，默认 false' })),
    }),
    async execute(_toolCallId, params) {
      const queryStartedAt = performance.now();
      const all = deps.libraryService.listResources({
        folderId: params.folderId,
        query: params.query,
        format: params.format,
        recursive: params.recursive,
      });
      const queryMs = Math.round(performance.now() - queryStartedAt);

      const offset = params.offset ?? 0;
      const limit = params.limit ?? DEFAULT_LIST_LIMIT;
      const page = all.slice(offset, offset + limit);
      const truncated = offset + page.length < all.length;
      const detail = params.detail === true;
      const columns = detail ? DETAIL_COLUMNS : BRIEF_COLUMNS;
      const rows = page.map(item =>
        detail
          ? [
              item.id,
              item.name,
              item.kind,
              item.format,
              item.sizeBytes,
              item.starred ? 1 : 0,
              item.childrenCount,
              item.pageCount,
              item.sectionCount,
              item.folderId,
              item.path,
            ]
          : [item.id, item.name, item.kind, item.format, item.sizeBytes]
      );

      const meta = [
        `total=${all.length}`,
        `truncated=${truncated}`,
        `fields=${columns.length}`,
        `ms=${queryMs}`,
      ];
      if (truncated) meta.push(`nextOffset=${offset + page.length}`);
      return plainTextResult(`# ${meta.join(' ')}\n${toTsv(columns, rows)}`);
    },
  });

  const pdfTocTool = defineSessionTool({
    name: 'resource_pdf_get_toc',
    description: '查看 PDF 的内置目录。',
    promptSnippet: '查看 PDF 目录',
    promptGuidelines: [
      'PDF 先用目录定位页码；读取顺序为文字层 → OCR → 页面图，前一种读不到或不完整时再用下一种。',
      `PDF 单次最多读 ${MAX_PDF_PAGES_PER_READ} 页；emptyPages 非空表示文字层缺失，missingPages 非空表示 OCR 缺失。`,
    ],
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
    }),
    async execute(_toolCallId, params) {
      return textResult(await deps.resourceReaderService.readPdfToc(params.resourceId));
    },
  });

  const pdfTextTool = defineSessionTool({
    name: 'resource_pdf_read_text',
    description: '按页码读取 PDF 文字层。',
    promptSnippet: '按页读取 PDF 文字层',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      startPage: Type.Integer({ minimum: 1, description: '起始物理页号，从 1 开始' }),
      endPage: Type.Optional(
        Type.Integer({ minimum: 1, description: '结束物理页号（含），省略时只读起始页' })
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(
        await deps.resourceReaderService.readPdfPageText(
          params.resourceId,
          params.startPage,
          params.endPage
        )
      );
    },
  });

  const pdfOcrTool = defineSessionTool({
    name: 'resource_pdf_read_ocr_text',
    description: '按页码读取 PDF 的 OCR 文字。',
    promptSnippet: '读取 PDF OCR 文字',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      startPage: Type.Integer({ minimum: 1, description: '起始物理页号，从 1 开始' }),
      endPage: Type.Optional(
        Type.Integer({ minimum: 1, description: '结束物理页号（含），省略时只读起始页' })
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(
        await deps.resourceReaderService.readPdfPageOcrText(
          params.resourceId,
          params.startPage,
          params.endPage
        )
      );
    },
  });

  const pdfImageTool = defineSessionTool({
    name: 'resource_pdf_read_page_image',
    description: '查看 PDF 某一页的页面图，适合确认版面、图表或公式。',
    promptSnippet: '查看 PDF 页面图',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      page: Type.Integer({ minimum: 1, description: '物理页号，从 1 开始' }),
    }),
    async execute(_toolCallId, params) {
      const result = await deps.resourceReaderService.readPdfPageImage(
        params.resourceId,
        params.page
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `PDF 第 ${result.page} 页（共 ${result.pageCount} 页）`,
          },
          result.image,
        ],
        details: undefined,
      };
    },
  });

  const epubTocTool = defineSessionTool({
    name: 'resource_epub_get_toc',
    description: '查看 EPUB 的目录和 xhtml 章节列表。',
    promptSnippet: '查看 EPUB 目录与章节列表',
    promptGuidelines: [
      'EPUB 先取目录与 section 列表；读取用 sectionIndex，不用目录 id，nextSectionIndex 用于续读。',
    ],
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
    }),
    async execute(_toolCallId, params) {
      return textResult(await deps.resourceReaderService.readEpubToc(params.resourceId));
    },
  });

  const epubSectionTool = defineSessionTool({
    name: 'resource_epub_read_section',
    description: '读取 EPUB 的一个 xhtml 章节。',
    promptSnippet: '读取 EPUB 章节',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      sectionIndex: Type.Integer({
        minimum: 0,
        description: '章节下标，从 0 开始，由 resource_epub_get_toc 返回',
      }),
      offset: READ_OFFSET,
      length: READ_LENGTH,
    }),
    async execute(_toolCallId, params) {
      const content = await deps.resourceReaderService.readEpubSection(
        params.resourceId,
        params.sectionIndex
      );
      const window = sliceTextWindow(content.text, {
        offset: params.offset,
        length: params.length,
      });
      return textResult({ ...content, ...window });
    },
  });

  const markdownTool = defineSessionTool({
    name: 'resource_md_read',
    description: '读取 Markdown 原文，可用 offset 续读。',
    promptSnippet: '读取 Markdown 原文',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      offset: READ_OFFSET,
      length: READ_LENGTH,
    }),
    async execute(_toolCallId, params) {
      const content = await deps.resourceReaderService.readTextResource(params.resourceId);
      const window = sliceTextWindow(content.text, {
        offset: params.offset,
        length: params.length,
      });
      return textResult({ ...content, ...window });
    },
  });

  const textTool = defineSessionTool({
    name: 'resource_txt_read',
    description: '读取纯文本原文，可用 offset 续读。',
    promptSnippet: '读取纯文本原文',
    parameters: Type.Object({
      resourceId: Type.String({ minLength: 1, description: '资料 id，由 resource_list 返回' }),
      offset: READ_OFFSET,
      length: READ_LENGTH,
    }),
    async execute(_toolCallId, params) {
      const content = await deps.resourceReaderService.readTextResource(params.resourceId);
      const window = sliceTextWindow(content.text, {
        offset: params.offset,
        length: params.length,
      });
      return textResult({ ...content, ...window });
    },
  });

  return [
    listTool,
    pdfTocTool,
    pdfTextTool,
    pdfOcrTool,
    pdfImageTool,
    epubTocTool,
    epubSectionTool,
    markdownTool,
    textTool,
  ];
}
