import type { Logger } from './contracts/logger';

let sink: Logger = console;

/** 由启动入口绑定日志实现；业务代码只认识 `log` 门面。 */
export function setLogSink(next: Logger): void {
  sink = next;
}

/** 全局日志门面。纯函数不要调用它；只在有副作用的编排/边界层使用。 */
export const log: Logger = {
  info: (...args) => sink.info(...args),
  warn: (...args) => sink.warn(...args),
  error: (...args) => sink.error(...args),
  debug: (...args) => sink.debug(...args),
};
