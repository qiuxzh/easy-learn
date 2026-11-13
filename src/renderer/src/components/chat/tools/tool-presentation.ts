/**
 * 工具在对话行上的展示信息。
 *
 * 标题与摘要都是「给人看」的，和后端工具定义里「给模型看」的 description 是两件事，
 * 因此不放在工具定义里，统一由渲染层维护这一份，避免同一条信息写两处而漂移。
 */
export interface ToolPresentation {
  /** 行上显示的标题；未登记的工具回退显示原始工具名。 */
  label: string;
  /**
   * 取入参里的哪个字段作为行摘要。
   * 不声明就不显示摘要——摘要一律显式指定，不做「取第一个字符串字段」这类推断。
   */
  summaryFrom?: string;
}

/** 工具名 → 展示信息。未登记的工具回退显示原始工具名。 */
export const TOOL_PRESENTATION: Record<string, ToolPresentation> = {
  // 资料
  resource_list: { label: '查看资料库', summaryFrom: 'query' },
  resource_pdf_get_toc: { label: '查看 PDF 目录' },
  resource_pdf_read_text: { label: '读取 PDF 文字层' },
  resource_pdf_read_ocr_text: { label: '读取 PDF OCR 文字' },
  resource_pdf_read_page_image: { label: '查看 PDF 页面图' },
  resource_epub_get_toc: { label: '查看 EPUB 目录' },
  resource_epub_read_section: { label: '读取 EPUB 章节' },
  resource_md_read: { label: '读取 Markdown 原文' },
  resource_txt_read: { label: '读取纯文本原文' },

  // 阅读（历史会话里的 book_* 工具名）
  get_book_tocs: { label: '读取目录' },
  read_book_toc_text: { label: '读取章节' },
  // 历史会话里的旧工具名，保留中文标签
  read_book_toc_section: { label: '读取章节' },
  search_book_bm25: { label: '检索书中内容', summaryFrom: 'query' },
  search_book_vector: { label: '语义检索书中内容', summaryFrom: 'query' },
  get_user_reading_state: { label: '获取阅读状态' },

  // 图片
  read_attachment_image: { label: '查看图片' },
  read_book_image: { label: '查看书中插图', summaryFrom: 'resourceKey' },

  // 闪卡
  list_card_groups: { label: '查看牌组列表' },
  get_flashcard: { label: '查看闪卡' },
  list_flashcards: { label: '查看闪卡列表' },
  create_flashcard: { label: '新增闪卡', summaryFrom: 'front' },
  update_flashcard: { label: '编辑闪卡' },
  delete_flashcard: { label: '删除闪卡' },
};
