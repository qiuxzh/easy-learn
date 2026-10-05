import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type ConfigPatch,
  type ConfigPath,
  type ConfigSnapshot,
} from '@shared/config';

interface ConfigState {
  /** 当前生效的配置快照 */
  config: AppConfig;
  /** 配置快照版本号 */
  revision: number;
  /** 是否已完成首次配置加载 */
  initialized: boolean;
  /** 是否正在加载配置 */
  loading: boolean;
  /** 是否有配置写入请求正在处理 */
  saving: boolean;
  /** 最近一次配置操作错误 */
  error: string | null;

  /** 初始化前端配置中心并订阅后端变更 */
  initialize: () => Promise<string | null>;
  /** 从本地快照读取配置项 */
  get: <K extends keyof AppConfig>(key: K) => AppConfig[K];
  /** 设置单个配置路径 */
  set: (path: ConfigPath, value: unknown) => Promise<string | null>;
  /** 批量更新配置 */
  update: (patch: ConfigPatch) => Promise<string | null>;
  /** 删除配置路径 */
  remove: (path: ConfigPath) => Promise<string | null>;
  /** 清除错误信息 */
  clearError: () => void;
}

/** 将异常转换成可展示的错误信息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useConfigStore = create<ConfigState>()(
  immer((set, get) => {
    let unsubscribeConfigChanged: (() => void) | null = null;

    /** 应用后端返回或推送的配置快照。 */
    const applySnapshot = (snapshot: ConfigSnapshot): void => {
      set(state => {
        if (snapshot.revision < state.revision) return;
        state.config = snapshot.config;
        state.revision = snapshot.revision;
        state.error = null;
      });
    };

    /** 统一执行配置写入并同步返回的快照。 */
    const runMutation = async (request: () => Promise<ConfigSnapshot>): Promise<string | null> => {
      set(state => {
        state.saving = true;
        state.error = null;
      });

      try {
        const snapshot = await request();
        applySnapshot(snapshot);
        return null;
      } catch (error) {
        const message = getErrorMessage(error);
        set(state => {
          state.error = message;
        });
        return message;
      } finally {
        set(state => {
          state.saving = false;
        });
      }
    };

    return {
      config: structuredClone(DEFAULT_APP_CONFIG),
      revision: 0,
      initialized: false,
      loading: false,
      saving: false,
      error: null,

      initialize: async () => {
        if (get().initialized || get().loading) return null;

        set(state => {
          state.loading = true;
          state.error = null;
        });

        try {
          if (!unsubscribeConfigChanged) {
            unsubscribeConfigChanged = window.api.config.onChanged(applySnapshot);
          }

          const snapshot = await window.api.config.get();
          applySnapshot(snapshot);
          set(state => {
            state.initialized = true;
          });
          return null;
        } catch (error) {
          const message = getErrorMessage(error);
          set(state => {
            state.error = message;
          });
          return message;
        } finally {
          set(state => {
            state.loading = false;
          });
        }
      },

      get: key => get().config[key],

      set: (path, value) => runMutation(() => window.api.config.set({ path, value })),

      update: patch => runMutation(() => window.api.config.update({ patch })),

      remove: path => runMutation(() => window.api.config.remove({ path })),

      clearError: () => {
        set(state => {
          state.error = null;
        });
      },
    };
  })
);
