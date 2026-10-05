import { BrowserWindow, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import { Compile } from 'typebox/compile';
import type { TLocalizedValidationError } from 'typebox/error';
import {
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type ConfigPatch,
  type ConfigPath,
  type ConfigRemoveRequest,
  type ConfigSetRequest,
  type ConfigSnapshot,
  type ConfigUpdateRequest,
} from '@shared/config';
import { IpcChannel } from '@shared/ipc-channels';
import { stripBom } from '@shared/utils/file-util';
import { clone, isRecord } from '@shared/utils/object-util';
import { BaseService } from '@main/service/base-service';
import { Constants } from '../constants';

const validateAppConfig = Compile(AppConfigSchema);

type ConfigRecord = Record<string, unknown>;
type ConfigContainer = ConfigRecord | unknown[];

/** 把 TypeBox 错误路径转换成可读文本。 */
function formatValidationPath(error: TLocalizedValidationError): string {
  if (error.keyword === 'required') {
    const required = (error.params as { requiredProperties?: string[] }).requiredProperties?.[0];
    if (required) {
      const base = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return base ? `${base}.${required}` : required;
    }
  }

  return error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'root';
}

/**
 * 用默认值补齐候选配置。
 * 对象递归合并，数组和标量由候选值覆盖；候选中的未知字段会原样保留。
 *
 * 示例：
 * defaults = { theme: 'light', reader: { fontSize: 14 } }
 * value    = { reader: { fontSize: 18 } }
 * result   = { theme: 'light', reader: { fontSize: 18 } }
 */
function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (value === undefined) return clone(defaults);
  if (Array.isArray(defaults)) return clone(value) as T;

  if (isRecord(defaults) && isRecord(value)) {
    const result: ConfigRecord = {};

    for (const [key, defaultValue] of Object.entries(defaults)) {
      result[key] = mergeDefaults(defaultValue, value[key]);
    }

    for (const [key, customValue] of Object.entries(value)) {
      if (!(key in result)) {
        result[key] = clone(customValue);
      }
    }

    return result as T;
  }

  return clone(value) as T;
}

/** 检查路径段是否可以作为数组索引。 */
function isArrayIndex(segment: string | number): segment is number {
  return typeof segment === 'number' && Number.isInteger(segment) && segment >= 0;
}

/** 按路径设置配置值，路径不存在时自动创建中间对象或数组。 */
function setValueAtPath(root: ConfigRecord, configPath: ConfigPath, value: unknown): void {
  if (configPath.length === 0) {
    throw new Error('配置路径不能为空');
  }

  let current: ConfigContainer = root;

  for (let index = 0; index < configPath.length - 1; index += 1) {
    const segment = configPath[index];
    const nextSegment = configPath[index + 1];

    if (Array.isArray(current)) {
      if (!isArrayIndex(segment)) {
        throw new Error('数组路径必须使用非负整数索引');
      }

      if (!Array.isArray(current[segment]) && !isRecord(current[segment])) {
        current[segment] = isArrayIndex(nextSegment) ? [] : {};
      }

      current = current[segment] as ConfigContainer;
      continue;
    }

    if (typeof segment !== 'string') {
      throw new Error('对象路径必须使用字符串键');
    }

    if (!Array.isArray(current[segment]) && !isRecord(current[segment])) {
      current[segment] = isArrayIndex(nextSegment) ? [] : {};
    }

    current = current[segment] as ConfigContainer;
  }

  const lastSegment = configPath[configPath.length - 1];

  if (Array.isArray(current)) {
    if (!isArrayIndex(lastSegment)) {
      throw new Error('数组路径必须使用非负整数索引');
    }

    current[lastSegment] = value;
    return;
  }

  if (typeof lastSegment !== 'string') {
    throw new Error('对象路径必须使用字符串键');
  }

  current[lastSegment] = value;
}

/** 按路径删除配置值，返回是否真的删除了内容。 */
function removeValueAtPath(root: ConfigRecord, configPath: ConfigPath): boolean {
  if (configPath.length === 0) return false;

  let current: ConfigContainer = root;

  for (let index = 0; index < configPath.length - 1; index += 1) {
    const segment = configPath[index];
    const next: unknown = Array.isArray(current)
      ? isArrayIndex(segment)
        ? current[segment]
        : undefined
      : typeof segment === 'string'
        ? current[segment]
        : undefined;

    if (!Array.isArray(next) && !isRecord(next)) {
      return false;
    }

    current = next;
  }

  const lastSegment = configPath[configPath.length - 1];

  if (Array.isArray(current)) {
    if (!isArrayIndex(lastSegment) || lastSegment >= current.length) {
      return false;
    }

    current.splice(lastSegment, 1);
    return true;
  }

  if (typeof lastSegment !== 'string' || !(lastSegment in current)) {
    return false;
  }

  delete current[lastSegment];
  return true;
}
/** 主进程配置中心，负责配置快照、迁移、持久化和 IPC。 */
export class ConfigService extends BaseService {
  private readonly configPath: string;
  private readonly listeners = new Set<(snapshot: ConfigSnapshot) => void>();
  private snapshot: AppConfig = clone(DEFAULT_APP_CONFIG);
  private revision = 0;
  private loadError: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this.configPath = path.resolve(Constants.dataDir, 'config.json');
    this.snapshot = this.loadSnapshot();
  }

  /** 注册配置 IPC handler。 */
  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Config_Get, () => this.getSnapshot());
    ipcMain.handle(IpcChannel.Config_Set, (_event, request: ConfigSetRequest) =>
      this.set(request.path, request.value)
    );
    ipcMain.handle(IpcChannel.Config_Update, (_event, request: ConfigUpdateRequest) =>
      this.update(request.patch)
    );
    ipcMain.handle(IpcChannel.Config_Remove, (_event, request: ConfigRemoveRequest) =>
      this.remove(request.path)
    );
  }

  /** 读取指定配置项。 */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    // 必须使用clone，防止外部调用该函数的地方修改了snapshot，从而绕过校验、落盘
    return clone(this.snapshot[key]);
  }

  /** 返回当前完整配置快照。 */
  getSnapshot(): ConfigSnapshot {
    return {
      revision: this.revision,
      config: clone(this.snapshot),
    };
  }

  /** 订阅配置变化。
   *  用于配置使用方收到最新的配置，在不重启应用的情况下实现配置的更新
   * */
  subscribeChange(listener: (snapshot: ConfigSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 设置单个配置路径。 */
  set(configPath: ConfigPath, value: unknown): Promise<ConfigSnapshot> {
    if (value === undefined) {
      return Promise.reject(new Error('set 的 value 不能是 undefined'));
    }

    return this.commit(current => {
      const draft = clone(current) as ConfigRecord;
      setValueAtPath(draft, configPath, value);
      return draft as AppConfig;
    });
  }

  /** 批量更新配置。对象递归合并，数组和标量直接替换。 */
  update(patch: ConfigPatch): Promise<ConfigSnapshot> {
    return this.commit(current => mergeDefaults(current, patch));
  }

  /** 删除指定配置路径。 */
  remove(configPath: ConfigPath): Promise<ConfigSnapshot> {
    return this.commit(current => {
      const draft = clone(current) as ConfigRecord;
      removeValueAtPath(draft, configPath);
      return draft as AppConfig;
    });
  }

  /** 把配置写入串行队列，避免并发覆盖。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** 统一执行配置修改、校验、落盘和通知。 */
  private commit(transform: (current: AppConfig) => AppConfig): Promise<ConfigSnapshot> {
    return this.enqueue(async () => {
      if (this.loadError) {
        throw new Error(`配置当前不可写: ${this.loadError}`);
      }

      const previous = clone(this.snapshot);
      const candidate = mergeDefaults(DEFAULT_APP_CONFIG, transform(clone(previous)));
      this.assertValidConfig(candidate);

      if (isDeepStrictEqual(candidate, previous)) {
        return this.getSnapshot();
      }

      this.writeConfigFile(candidate);
      this.snapshot = candidate;
      this.revision += 1;
      this.emitChange();
      return this.getSnapshot();
    });
  }

  /** 加载 config.json，并把缺失的默认字段补全后保存。 */
  private loadSnapshot(): AppConfig {
    mkdirSync(path.dirname(this.configPath), { recursive: true });

    let rawConfig: ConfigRecord;
    let shouldPersist = false;

    try {
      const result = this.readMainConfig();
      rawConfig = result.config;
      shouldPersist = result.shouldPersist;
    } catch (error) {
      this.loadError = `配置读取失败: ${error instanceof Error ? error.message : error}`;
      return clone(DEFAULT_APP_CONFIG);
    }

    const candidate = mergeDefaults(DEFAULT_APP_CONFIG, rawConfig);

    try {
      this.assertValidConfig(candidate);
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
      return clone(DEFAULT_APP_CONFIG);
    }

    try {
      const shouldWriteNormalized = !isDeepStrictEqual(rawConfig, candidate);

      if (shouldPersist || shouldWriteNormalized) {
        this.writeConfigFile(candidate);
      }
    } catch (error) {
      this.loadError = `配置保存失败: ${error instanceof Error ? error.message : error}`;
    }

    return candidate;
  }

  /** 读取 config.json。JSON 损坏时改名成 .old.json 并使用默认配置。 */
  private readMainConfig(): { config: ConfigRecord; shouldPersist: boolean } {
    if (!existsSync(this.configPath)) {
      return { config: {}, shouldPersist: true };
    }

    const content = readFileSync(this.configPath, 'utf-8');

    try {
      const parsed = JSON.parse(stripBom(content));

      if (!isRecord(parsed)) {
        throw new Error('配置根节点必须是对象');
      }

      return { config: parsed, shouldPersist: false };
    } catch {
      this.moveToOldFile(this.configPath);
      return { config: {}, shouldPersist: true };
    }
  }

  /** 把损坏文件改名为 .old.json，已有同名备份时覆盖。 */
  private moveToOldFile(filePath: string): void {
    const oldPath = filePath.replace(/\.json$/i, '.old.json');

    if (existsSync(oldPath)) {
      rmSync(oldPath, { force: true });
    }

    renameSync(filePath, oldPath);
  }

  /** 校验完整配置，并抛出带字段路径的错误。 */
  private assertValidConfig(config: unknown): asserts config is AppConfig {
    if (validateAppConfig.Check(config)) {
      return;
    }

    const details =
      validateAppConfig
        .Errors(config)
        .map(error => `  - ${formatValidationPath(error)}: ${error.message}`)
        .join('\n') || '未知的校验错误';

    throw new Error(`配置不合法:\n${details}`);
  }

  /** 原子写入 config.json。 */
  private writeConfigFile(config: AppConfig): void {
    mkdirSync(path.dirname(this.configPath), { recursive: true });

    const tempPath = `${this.configPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    renameSync(tempPath, this.configPath);
  }

  /** 广播配置变更给 Main 订阅者和所有 Renderer 窗口。 */
  private emitChange(): void {
    const snapshot = this.getSnapshot();

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // 单个订阅者失败不影响其他订阅者和渲染进程
      }
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcChannel.Config_Changed, snapshot);
      }
    }
  }
}

export const configService = new ConfigService();
