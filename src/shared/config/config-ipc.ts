import type { AppConfig } from './schema/app-config-schema';

type DeepPartial<T> = T extends readonly (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * 配置项路径。使用数组避免点号分隔符在 provider id 等字段中产生歧义。
 *
 * 示例：['ocr', 'paddle-ocr', 'token']
 */
export type ConfigPath = readonly (string | number)[];

/**
 * 局部配置更新载荷。
 *
 * 示例：{ ocr: { 'paddle-ocr': { token: 'new-token' } } }
 */
export type ConfigPatch = DeepPartial<AppConfig>;

/** 后端返回给前端的完整配置快照。 */
export interface ConfigSnapshot {
  /** 每次成功变更后递增的版本号 */
  revision: number;
  /** 当前生效的完整配置 */
  config: AppConfig;
}

/** set 操作的 IPC 请求。 */
export interface ConfigSetRequest {
  path: ConfigPath;
  value: unknown;
}

/** update 操作的 IPC 请求。 */
export interface ConfigUpdateRequest {
  patch: ConfigPatch;
}

/** remove 操作的 IPC 请求。 */
export interface ConfigRemoveRequest {
  path: ConfigPath;
}
