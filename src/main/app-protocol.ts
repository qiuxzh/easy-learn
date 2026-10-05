import { protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import log from 'electron-log';
import mime from 'mime-types';
import { Constants } from './constants';

/**
 * app:// 自定义协议
 *
 * URL 格式：app:///{relativePath}，relativePath 是相对于 Constants.dataDir 的路径
 * 仅 dataDir 内部的文件可被访问，使用 path.relative 校验防越权
 *
 * 注册时机：
 * - registerAppProtocolPrivileges 必须在 app.ready 之前执行（声明 scheme 的 privileged 属性）
 * - registerAppProtocol 在 app.ready 之后执行（注册 handler）
 */
export function registerAppProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true, // 标记为标准协议，使 fetch 可用（img 不需要，但 fetch 严格依赖）
        secure: true, // 允许 fetch API
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true, // 支持流式读取（适合大文件）
      },
    },
  ]);
}

async function handleAppRequest(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);

    // 浏览器把 app:///path 解析为 hostname="path的第一段" + pathname="/剩余段"
    // 因此 hostname 也是有效路径的一部分，需要拼接
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (!pathname || pathname === '/') {
      return new Response('Bad Request', { status: 400 });
    }

    const normalizedRoot = path.resolve(Constants.dataDir);
    // 去掉 pathname 前导 / 防止 Windows 下被当作绝对路径
    const cleanedPath = url.hostname ? pathname.replace(/^\/+/, '') : pathname.replace(/^\/+/, '');
    const target = path.resolve(normalizedRoot, url.hostname, cleanedPath);

    // 路径越权校验：必须落在 normalizedRoot 之下
    const relative = path.relative(normalizedRoot, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      log.warn('[app://] blocked (path traversal):', req.url, '->', target);
      return new Response('Forbidden', { status: 403 });
    }

    const fileResp = await net.fetch(pathToFileURL(target).href);
    if (fileResp.status === 404) {
      return new Response('Not Found', { status: 404 });
    }

    // net.fetch(file://) 的 Response 不带 Content-Type，fetch 严格依赖该头
    const mimeType = mime.lookup(target) || 'application/octet-stream';

    return new Response(fileResp.body, {
      status: fileResp.status,
      statusText: fileResp.statusText,
      headers: { 'Content-Type': mimeType },
    });
  } catch (e) {
    log.error('[app://] request error:', e);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export function registerAppProtocol(): void {
  protocol.handle('app', handleAppRequest);
  log.info('[app://] custom protocol registered');
}
