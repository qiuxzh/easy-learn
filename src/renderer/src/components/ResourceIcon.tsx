import type { ResourceFormat } from '@shared/types/library';
import { cn } from '@/lib/utils';
import epubIcon from '@/assets/library/epub.svg';
import fileIcon from '@/assets/library/file.svg';
import folderIcon from '@/assets/library/folder.svg';
import mdIcon from '@/assets/library/md.svg';
import pdfIcon from '@/assets/library/pdf.svg';
import txtIcon from '@/assets/library/txt.svg';

/** 格式到静态图标的映射。 */
const FORMAT_ICON: Record<ResourceFormat, string> = {
  pdf: pdfIcon,
  epub: epubIcon,
  md: mdIcon,
  txt: txtIcon,
};

/** 网格尺寸下两类图标各自的宽高，与 SVG 画布一致。 */
const FOLDER_SIZE = { width: 56, height: 49 };
const FILE_SIZE = { width: 46, height: 58 };

/**
 * 资料库条目图标：使用打包进资源的静态 SVG，未知格式回落到中性纸页。
 */
export function ResourceIcon({
  kind,
  format,
  size = 'md',
  className,
}: {
  kind: 'folder' | 'file';
  format?: ResourceFormat | null;
  /** md 用于网格，row 用于文件夹行与目录树，sm 用于详情行。 */
  size?: 'sm' | 'row' | 'md';
  className?: string;
}) {
  const icon = kind === 'folder' ? folderIcon : format ? FORMAT_ICON[format] : fileIcon;
  const dimensions = kind === 'folder' ? FOLDER_SIZE : FILE_SIZE;
  const scale = size === 'md' ? 1 : size === 'row' ? 0.6 : 0.42;

  return (
    <img
      src={icon}
      alt=""
      draggable={false}
      className={cn('shrink-0 select-none', className)}
      style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
    />
  );
}
