import { ipcMain } from 'electron';
import log from 'electron-log';
import { DomainError } from '@main/domain-error';

/** 成功时随 `success` 一起返回的字段；返回空对象表示只带 `success`。 */
export type HandlerResult = Record<string, unknown>;

/**
 * 注册一条 IPC 处理器，并统一成败外壳。
 *
 * 业务异常在这里就地转成 `{ success: false, error }`：renderer 收到的 promise 一旦被
 * reject，Electron 会改写错误消息并丢掉自定义字段，错误原因传不过去。
 *
 * `DomainError` 的文案面向用户，原样返回；其它异常视为内部故障，只记日志、回统一文案。
 *
 * @param channel IPC 通道名
 * @param run 处理器实现，参数是 renderer 传来的请求；抛出的异常会被转换成失败信封
 */
export function registerHandler<Request>(
  channel: string,
  run: (request: Request) => HandlerResult | Promise<HandlerResult>
): void {
  ipcMain.handle(channel, async (_event, request: Request) => {
    try {
      return { success: true, ...(await run(request)) };
    } catch (error) {
      if (error instanceof DomainError) {
        return { success: false, error: error.message };
      }
      log.error(`[IPC] ${channel} 执行失败:`, error);
      return { success: false, error: '内部错误，请稍后重试' };
    }
  });
}

/**
 * 注册一条直接返回业务结果的 IPC 处理器。
 *
 * 与 `handle` 的区别是不套 `{ success }` 外壳：这些通道的既有契约就是原始结果或 rejection。
 * 领域错误转成只带用户文案的 Error，其余异常记日志后原样抛出。
 *
 * @param channel IPC 通道名
 * @param run 处理器实现，返回值原样交给渲染层
 */
export function registerDirectHandler<Request>(
  channel: string,
  run: (request: Request) => unknown | Promise<unknown>
): void {
  ipcMain.handle(channel, async (_event, request: Request) => {
    try {
      return await run(request);
    } catch (error) {
      if (error instanceof DomainError) throw new Error(error.message);
      log.error(`[IPC] ${channel} 执行失败:`, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  });
}
