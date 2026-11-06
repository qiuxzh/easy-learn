import { isDeepStrictEqual } from 'node:util';
import type { ConfigService } from '@main/infra/config-service';
import type { ModelConfig } from '@main/contracts/model-config';

/**
 * 基于配置中心的模型配置来源。
 *
 * 变化判定放在这里：配置快照每次修改都会广播，只有模型段真的变了才通知订阅方，
 * 否则重建模型运行时会打断正在进行的会话。
 *
 * @param config 装配根持有的配置中心
 */
export function createModelConfig(config: ConfigService): ModelConfig {
  return {
    getModels: () => config.get('models'),

    subscribeModels: listener => {
      let previous = config.get('models');
      return config.subscribeChange(snapshot => {
        if (isDeepStrictEqual(previous, snapshot.config.models)) return;
        previous = snapshot.config.models;
        listener();
      });
    },
  };
}
