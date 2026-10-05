/**
 * 桥接 foliate-js iframe 内的键盘事件到主窗口。
 *
 * foliate-js 把书籍内容渲染到 sandbox iframe 中，
 * iframe 内的键盘事件不会冒泡到父页面。
 * 此模块在 iframe 的 contentDocument 上注册 keydown 监听器，
 * 通过 window.postMessage 转发到主窗口供 React 层使用。
 */

interface RegisteredDocument extends Document {
  __foliateBridgeRegistered?: boolean;
}

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
