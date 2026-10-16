/**
 * 阅读区内容交互策略：边缘翻页判定、文字层选区抑制判定。
 *
 * 这些判定同时被 iframe 事件桥（翻页）与 PDF 页面渲染（抑制空白处误选）使用，
 * 放在这里做单一来源；全部是纯函数，不碰 DOM 实现细节，便于单测。
 */

/** 拖动超过该像素距离视为选中文字，不算点击 */
export const CLICK_DRAG_TOLERANCE_PX = 6;

/** 左右边缘区域宽度：至少 48px，同时不小于阅读区宽度的 6% */
const EDGE_ZONE_MIN_PX = 48;
const EDGE_ZONE_RATIO = 0.06;

/** 点到链接、按钮这类元素时不翻页，也不参与空白处手势 */
export const INTERACTIVE_SELECTOR = 'a[href], button, input, textarea, select, [role="button"]';

/** 阅读区几何：只取判定需要的两个字段，DOMRect 可直接传入 */
export interface ReaderZoneRect {
  /** 阅读区左边缘的屏幕横坐标 */
  left: number;
  /** 阅读区宽度 */
  width: number;
}

/** 点击位置落在阅读区左 / 右边缘的哪一侧；不在边缘返回 null */
export function resolveEdgeDirection(
  clientX: number,
  rect: ReaderZoneRect
): 'left' | 'right' | null {
  if (rect.width <= 0) return null;
  const zone = Math.max(EDGE_ZONE_MIN_PX, rect.width * EDGE_ZONE_RATIO);
  const x = clientX - rect.left;
  if (x <= zone) return 'left';
  if (x >= rect.width - zone) return 'right';
  return null;
}

/** 一次按下的语义信息 */
export interface SelectionPress {
  /** 是否左键 */
  primaryButton: boolean;
  /** 点击次数，大于 1 表示连点 */
  detail: number;
  /** 按在文字上 */
  onText: boolean;
  /** 按在链接或按钮上 */
  onInteractive: boolean;
}

/**
 * 这次按下是否需要阻止浏览器的默认行为。
 *
 * 文字层的 span 全是绝对定位（PDF）：在页面空白处按下时，浏览器会把选区锚点落到页面开头
 * 那个文本节点上，手抖几像素就从页首选到指针处；在文字上连点则会选词、选段。
 * 这两种都不是我们想保留的行为，其余情况（点在文字上单击、点链接按钮）一律放行。
 */
export function shouldSuppressSelection(press: SelectionPress): boolean {
  if (!press.primaryButton || press.onInteractive) return false;
  if (!press.onText) return true;
  return press.detail > 1;
}

/** 一次松手的语义信息 */
export interface ClickRelease {
  /** 按下到松手的横向位移 */
  deltaX: number;
  /** 按下到松手的纵向位移 */
  deltaY: number;
  /** 按下时是否已经有残留选区 */
  hadSelectionOnPress: boolean;
  /** 松手时是否存在选区 */
  hasSelectionNow: boolean;
}

/**
 * 这次松手是否算「单纯点击了一下」（而不是拖选文字）。
 *
 * 按下时就存在的残留选区不算本次选择：否则上一次误选留下的选区会让边缘点击永远不翻页。
 */
export function isClickRelease(release: ClickRelease): boolean {
  if (Math.abs(release.deltaX) > CLICK_DRAG_TOLERANCE_PX) return false;
  if (Math.abs(release.deltaY) > CLICK_DRAG_TOLERANCE_PX) return false;
  if (release.hasSelectionNow && !release.hadSelectionOnPress) return false;
  return true;
}
