import { describe, expect, it } from 'vitest';
import { ModelRuntime } from '../model-runtime';
import type { StreamFn } from '../stream-fn';
import type { Api } from '@shared/types/chat';
import type { Model } from '../types';

/** 造一个始终返回同一份配置的加载器 */
function loaderOf(config: unknown): () => unknown {
  return () => config;
}

const config = {
  default: { provider: 'deepseek', model: 'deepseek-reasoner' },
  providers: {
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-deepseek',
      models: [
        { id: 'deepseek-chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: true, maxTokens: 8192 },
      ],
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      models: [{ id: 'gpt-4o' }],
    },
  },
};

describe('ModelRuntime', () => {
  it('加载合法配置，并按默认值补全模型', () => {
    const runtime = ModelRuntime.create(loaderOf(config));

    expect(runtime.getError()).toBeUndefined();
    expect(runtime.listProviders()).toEqual(['deepseek', 'openai']);
    expect(runtime.getModel('deepseek', 'deepseek-chat')).toEqual({
      id: 'deepseek-chat',
      name: 'deepseek-chat',
      api: 'openai-completions',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      reasoning: false,
      input: ['text'],
      contextWindow: 128000,
      maxTokens: 128000, // 与 MODEL_DEFAULTS.maxTokens 保持同步
    });
  });

  it('模型级 api 覆盖 provider 级 api', () => {
    const runtime = ModelRuntime.create(loaderOf(config));

    expect(runtime.getModel('openai', 'gpt-4o')?.api).toBe('openai-responses');
  });

  it('解析模型的思考级别对照表', () => {
    const runtime = ModelRuntime.create(
      loaderOf({
        providers: {
          deepseek: {
            baseUrl: 'https://api.deepseek.com',
            models: [
              { id: 'deepseek-reasoner', thinkingLevelMap: { max: 'high' } },
              { id: 'deepseek-chat' },
            ],
          },
        },
      })
    );

    expect(runtime.getError()).toBeUndefined();
    expect(runtime.getModel('deepseek', 'deepseek-reasoner')?.thinkingLevelMap).toEqual({
      max: 'high',
    });
    // 未声明的模型不带该字段，由适配器兜底
    expect(runtime.getModel('deepseek', 'deepseek-chat')?.thinkingLevelMap).toBeUndefined();

    const typo = ModelRuntime.create(
      loaderOf({
        providers: {
          deepseek: {
            baseUrl: 'https://api.deepseek.com',
            models: [{ id: 'deepseek-reasoner', thinkingLevelMap: { highest: 'high' } }],
          },
        },
      })
    );
    expect(typo.getError()).toContain('不合法');
  });

  it('配置不合法时整体不生效，并通过 getError 暴露原因', () => {
    const runtime = ModelRuntime.create(loaderOf({ providers: { broken: {} } }));

    expect(runtime.getError()).toContain('不合法');
    expect(runtime.listModels()).toEqual([]);
    expect(runtime.getDefaultModel()).toBeUndefined();
  });

  it('读取失败时按空配置处理', () => {
    const runtime = ModelRuntime.create(() => {
      throw new Error('disk on fire');
    });

    expect(runtime.getError()).toContain('disk on fire');
    expect(runtime.listProviders()).toEqual([]);
  });

  it('按 provider 取授权信息', () => {
    const runtime = ModelRuntime.create(loaderOf(config));

    expect(runtime.getAuth('deepseek')).toEqual({
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(runtime.getAuth('not-exist')).toBeUndefined();
  });

  it('默认模型：声明有效时用声明，无效时回退到第一个', () => {
    expect(ModelRuntime.create(loaderOf(config)).getDefaultModel()?.id).toBe('deepseek-reasoner');

    const fallback = ModelRuntime.create(
      loaderOf({
        default: { provider: 'ghost', model: 'ghost' },
        providers: { deepseek: { baseUrl: 'https://x', models: [{ id: 'deepseek-chat' }] } },
      })
    );
    expect(fallback.getDefaultModel()?.id).toBe('deepseek-chat');
  });

  it('createStreamFn 对已注册的 api 返回实现，对未注册的 api 产出 error 流', async () => {
    const runtime = ModelRuntime.create(loaderOf(config));
    const streamFn: StreamFn = runtime.createStreamFn();
    const base = runtime.getModel('deepseek', 'deepseek-chat') as Model<Api>;

    const failed = await streamFn({ ...base, api: 'no-such-api' }, { messages: [] });
    const eventTypes: string[] = [];
    for await (const event of failed) eventTypes.push(event.type);

    expect(eventTypes).toEqual(['error']);
    expect((await failed.result()).errorMessage).toContain('no-such-api');
  });
});
