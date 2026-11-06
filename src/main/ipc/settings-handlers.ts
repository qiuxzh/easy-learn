import { IpcChannel } from '@shared/ipc-channels';
import type {
  ConfigSnapshot,
  ConfigRemoveRequest,
  ConfigSetRequest,
  ConfigUpdateRequest,
} from '@shared/config';
import type { TestEmbeddingEndpointRequest } from '@shared/types/embedding';
import type { ConfigService } from '@main/infra/config-service';
import type { EmbeddingService } from '@main/service/embedding-service';
import { registerDirectHandler, registerHandler } from './register-handler';

/**
 * 注册设置相关通道：配置读写与向量端点连通性测试。
 *
 * 配置的返回体就是快照本身，渲染层直接使用，因此配置通道不套成功信封；
 * 端点测试沿用统一信封。
 *
 * @param config 装配根持有的配置中心
 * @param embedding 向量端点测试服务
 */
export function registerSettingsHandlers(config: ConfigService, embedding: EmbeddingService): void {
  registerDirectHandler(IpcChannel.Config_Get, (): ConfigSnapshot => config.getSnapshot());
  registerDirectHandler(IpcChannel.Config_Set, (request: ConfigSetRequest) =>
    config.set(request.path, request.value)
  );
  registerDirectHandler(IpcChannel.Config_Update, (request: ConfigUpdateRequest) =>
    config.update(request.patch)
  );
  registerDirectHandler(IpcChannel.Config_Remove, (request: ConfigRemoveRequest) =>
    config.remove(request.path)
  );

  registerHandler<TestEmbeddingEndpointRequest>(IpcChannel.Embedding_TestEndpoint, request =>
    embedding.testEndpoint(request)
  );
}
