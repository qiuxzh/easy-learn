import type { ResourceFormat } from '@shared/types/library';

/** 格式的展示名。 */
export const FORMAT_LABEL: Record<ResourceFormat, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  md: 'MD',
  txt: 'TXT',
};

/** 把字节数格式化成可读文案。 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 把毫秒时间戳格式化成日期。 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
