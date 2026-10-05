/** 当前支持的书类型。后续新增文件类型只需扩展这个联合类型 */
import type { FoliateBook } from '@/components/reader/foliate-types';

export type BookType = 'epub';

/** 封面图片的字节 + 扩展名。Blob 不能跨 IPC 传输，拆成这两个字段 */
export interface CoverImage {
  bytes: Uint8Array;
  ext: string;
}

// reader所需要的书的实体类型
export interface BookEntity {
  id: string; // 书籍的id
  metadata: BookMetadata; // 书籍的元信息
  type: BookType;
  // 目录（已展平的扁平结构，由 flattenToc 从 rawBook.toc 生成）
  tocs?: TOCItem[];
  // foliate-js 解析出的原始对象。运行时渲染需要的 sections/toc/metadata 等都从这里取
  rawBook: FoliateBook;
}

/**
 *
 *   eg
 *     {
 *       id: '0',
 *       title: '章节概要与阅读导图',
 *       level: 0,
 *       href: 'Fan_Cui_Ruo__Cong_Bu_Que_Ding_X_split_005.html'
 *        subitems: [Array]
 *     },
 *     {
 *       id: '1',
 *       title: '前言',
 *       level: 0,
 *       href: 'Fan_Cui_Ruo__Cong_Bu_Que_Ding_X_split_006.html'
 *     },
 */
export interface TOCItem {
  id: string;
  title: string;
  level: number; // 层级
  href?: string; // "EPUB/xhtml/Section0059.xhtml"
  subitems?: TOCItem[];
}

export interface BookMetadata {
  title: string;
  author?: string;
  cover: CoverImage | undefined;
  type: BookType;
}

/** 渲染端展示用的书籍实体 */
export interface BookDoc {
  id: string;
  booksName: string;
  booksType: BookType;
  coverUrl: string | null; // app开头的url
  totalPages: number | null;
  totalChapters: number | null;
  description: string | null;
  author: string | null;
  createdAt: number;
}

/** 导入书籍响应（main 端完成 dialog + 解析 + 写库后返回） */
export interface BookImportResult {
  success: boolean;
  /** 用户取消选择时为 false 且无 error */
  canceled?: boolean;
  book?: BookDoc;
  error?: string;
}

/** 获取所有书籍响应 */
export interface BookListResult {
  success: boolean;
  books?: BookDoc[];
  error?: string;
}

/** 删除书籍请求 */
export interface BookDeleteRequest {
  /** 要删除的书籍 ID */
  id: string;
}

/** 删除书籍响应 */
export interface BookDeleteResult {
  success: boolean;
  error?: string;
}

/** 获取书籍文件路径请求（阅读器打开书时使用） */
export interface BookGetRequest {
  id: string;
}

/** 获取书籍文件路径响应 */
export interface BookGetResult {
  success: boolean;
  /** app:// 协议 URL，渲染端用 fetch 即可直接读取（替代旧的 IPC 读 buffer） */
  url?: string;
  /** 文件类型（冗余存储，避免前端再查 DB） */
  type?: BookType;
  error?: string;
}
