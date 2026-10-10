/**
 * 阅读区交互事件的注册与转发。
 *
 * 阅读区指放书的那块区域。本文件把用户在这里的按键和点击转成消息发给主窗口，
 * 调用方只处理语义化的结果（哪个按键、左还是右），不需要接触 iframe 和坐标计算。
 */

interface RegisteredDocument extends Document {
  __foliateBridgeRegistered?: boolean;
  __foliateEdgeClickRegistered?: boolean;
}

interface RegisteredElement extends HTMLElement {
  __foliateEdgeClickRegistered?: boolean;
}

/** 拖动超过该像素距离视为选中文字，不算点击 */
const CLICK_DRAG_TOLERANCE_PX = 6;

/** 左右边缘区域宽度：至少 48px，同时不小于阅读区宽度的 6% */
const EDGE_ZONE_MIN_PX = 48;
const EDGE_ZONE_RATIO = 0.06;

/** 点到链接、按钮这类元素时不翻页 */
const INTERACTIVE_SELECTOR = 'a[href], button, input, textarea, select, [role="button"]';

/** 注册键盘监听：把 iframe 内的按键转发给主窗口 */
export function registerIframeKeyHandlers(doc: Document, tabId: string): void {
  const d = doc as RegisteredDocument;
  if (d.__foliateBridgeRegistered) return;
  d.__foliateBridgeRegistered = true;

  doc.addEventListener('keydown', (event: KeyboardEvent) => {
    // iframe 内部发消息给父窗口
    window.postMessage(
      {
        type: 'foliate-bridge:keydown',
        tabId,
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        defaultPrevented: event.defaultPrevented,
      },
      '*'
    );
  });
}

/**
 * 注册「点击左右边缘翻页」。
 *
 * 阅读区里点击会落在两个地方：iframe 里的书内容，和 iframe 外面那圈空白
 * （foliate 给书页留的边距）。两处的事件来源不同，要分别挂监听，这个函数一次
 * 处理完；坐标换算和边缘判断也在内部做完，只把结果（左 / 右）发给主窗口。
 *
 * 每次章节加载后调用一次。
 *
 * @param doc 章节 iframe 的 document
 * @param container 阅读区容器（判断左右边缘时以它为准）
 * @param tabId 所属阅读 tab
 */
export function registerReaderEdgeClick(
  doc: Document,
  container: HTMLElement,
  tabId: string
): void {
  attachPaddingEdgeClick(container, tabId);
  attachContentEdgeClick(doc, container, tabId);
}

/**
 * iframe 外面那圈空白：点击事件在主文档里冒泡到容器。
 *
 * 这里不用做任何判断：空白处没有文字也没有链接，而用 click 监听时，
 * 从书内容拖到空白再松手不会产生 click，浏览器已经替我们排除了「拖」。
 *
 * 只在容器上挂一次，重复挂会导致一次点击翻两页。
 * 不要在卸载时解绑：容器元素卸载时监听器会一并回收，解绑反而会导致换书后失效。
 */
function attachPaddingEdgeClick(container: HTMLElement, tabId: string): void {
  const el = container as RegisteredElement;
  if (el.__foliateEdgeClickRegistered) return;
  el.__foliateEdgeClickRegistered = true;

  container.addEventListener('click', (event: MouseEvent) => {
    const direction = resolveEdgeDirection(event.clientX, container.getBoundingClientRect());
    if (direction) postEdgeClick(tabId, direction);
  });
}

/**
 * iframe 里的书内容：点击落在章节 iframe 内。
 *
 * 不拦截任何事件：选中文字、点链接、定位光标都照常，只在 pointerup 时判断
 * 这次点击是不是「单纯地点了一下」（而不是拖选文字）。
 * 监听器随 iframe 销毁而消失，不需要解绑。
 */
function attachContentEdgeClick(doc: Document, container: HTMLElement, tabId: string): void {
  const d = doc as RegisteredDocument;
  if (d.__foliateEdgeClickRegistered) return;
  d.__foliateEdgeClickRegistered = true;

  let downX = 0;
  let downY = 0;
  let hadSelection = false; // pointerdown 时是否已经选中了文字
  let downSeen = false; // pointerdown 是否落在 iframe 里

  /** 复位按下时的记录，避免交互跨区域时残留到下一次点击 */
  const resetDown = () => {
    downSeen = false;
    hadSelection = false;
  };

  doc.addEventListener('pointerdown', (event: PointerEvent) => {
    downSeen = true;
    downX = event.clientX;
    downY = event.clientY;
    hadSelection = !(doc.getSelection()?.isCollapsed ?? true);
  });

  doc.addEventListener('pointerout', (event: PointerEvent) => {
    // relatedTarget 为空表示指针离开了这个 iframe
    if (!event.relatedTarget) resetDown();
  });
  doc.addEventListener('pointercancel', resetDown);

  doc.addEventListener('pointerup', (event: PointerEvent) => {
    // 按下不在 iframe 里（例如从外面拖进来后松手）
    if (!downSeen) return;
    const hadSel = hadSelection;
    resetDown();
    // 按下时已经选中了文字，说明这次点击是用来取消选中的，不翻页
    if (hadSel) return;
    // 位移过大，是拖选
    if (Math.abs(event.clientX - downX) > CLICK_DRAG_TOLERANCE_PX) return;
    if (Math.abs(event.clientY - downY) > CLICK_DRAG_TOLERANCE_PX) return;
    // 选中了文字（拖选），不翻页
    if (!(doc.getSelection()?.isCollapsed ?? true)) return;
    // 点到链接或按钮，交给它们自己处理
    const target = event.target as Element | null;
    if (target?.closest?.(INTERACTIVE_SELECTOR)) return;

    const clientX = resolveIframeClientX(doc, event.clientX);
    if (clientX === null) return;
    const direction = resolveEdgeDirection(clientX, container.getBoundingClientRect());
    if (direction) postEdgeClick(tabId, direction);
  });
}

/** 点击位置落在阅读区左 / 右边缘的哪一侧；不在边缘返回 null */
function resolveEdgeDirection(clientX: number, rect: DOMRect): 'left' | 'right' | null {
  if (rect.width <= 0) return null;
  const zone = Math.max(EDGE_ZONE_MIN_PX, rect.width * EDGE_ZONE_RATIO);
  const x = clientX - rect.left;
  if (x <= zone) return 'left';
  if (x >= rect.width - zone) return 'right';
  return null;
}

/**
 * 把 iframe 内的横坐标换算成屏幕上的横坐标。
 *
 * iframe 里装的是整章（foliate 把整章横向排成多栏），所以 clientX 是相对整章
 * 左边缘的，不是相对屏幕；iframe 自身的 rect 已经包含滚动偏移，加上即可。
 * 拿不到 iframe 时返回 null，本次点击不翻页。
 */
function resolveIframeClientX(doc: Document, iframeClientX: number): number | null {
  const frame = doc.defaultView?.frameElement;
  if (!frame) return null;

  const frameRect = frame.getBoundingClientRect();
  // iframe 可能被 CSS 缩放（固定布局），用布局宽度换算回 CSS 像素
  const scaleX = frame.clientWidth > 0 ? frameRect.width / frame.clientWidth : 1;
  return frameRect.left + iframeClientX * scaleX;
}

/** 把结果发给主窗口，由调用方决定怎么翻页 */
function postEdgeClick(tabId: string, direction: 'left' | 'right'): void {
  window.postMessage(
    {
      type: 'foliate-bridge:edge-click',
      tabId,
      direction,
    },
    '*'
  );
}
