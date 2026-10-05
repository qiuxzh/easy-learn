import { createServer, type ServerResponse } from 'http';
import { describe, expect, it } from 'vitest';
import { Type } from 'typebox';
import { createOpenAiCompletionsStreamFn } from '../api/openai-completions';
import type { StreamFn } from '../stream-fn';
import type { Api, AssistantMessage, AssistantMessageEvent, Message } from '@shared/types/chat';
import type { Model, StreamOptions } from '../types';

/** 一帧 SSE 分片的载荷 */
type Chunk = Record<string, unknown>;

/** 把若干分片拼成 OpenAI 兼容的 SSE 响应体 */
function toSse(chunks: Chunk[]): string {
  return chunks.map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n';
}

/** 造一帧分片；choices 为空表示这是只带 usage 的收尾帧 */
function chunk(choices: Chunk[], usage?: Chunk): Chunk {
  return {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices,
    ...(usage ? { usage } : {}),
  };
}

/** 启动一个假的 OpenAI 兼容服务，返回 baseUrl、最近一次请求体与关闭函数 */
async function startFakeServer(
  handler: (res: ServerResponse) => void
): Promise<{ baseUrl: string; lastBody: () => any; close: () => Promise<void> }> {
  let lastBody: any;
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', part => parts.push(part));
    req.on('end', () => {
      lastBody = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf-8')) : undefined;
      handler(res);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    lastBody: () => lastBody,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const model: Model<Api> = {
  id: 'deepseek-chat',
  name: 'deepseek-chat',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'http://127.0.0.1:1/v1',
  reasoning: false,
  input: ['text'],
  contextWindow: 128000,
  maxTokens: 1024,
};

const userMessage = { role: 'user' as const, content: '天气如何', timestamp: 1 };

/** 跑完一次请求，收集全部事件与最终消息 */
async function collect(
  streamFn: StreamFn
): Promise<{ events: AssistantMessageEvent[]; final: AssistantMessage }> {
  const stream = await streamFn(model, { messages: [userMessage] });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, final: await stream.result() };
}

describe('createOpenAiCompletionsStreamFn', () => {
  it('把系统提示词作为第一条 system 消息发送，空提示词不插入', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toSse([chunk([{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }])]));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));

      /** 跑一次请求并返回接口收到的请求体 */
      const run = async (systemPrompt?: string) => {
        const stream = await streamFn(model, { systemPrompt, messages: [userMessage] });
        for await (const event of stream) void event;
        return server.lastBody();
      };

      const withSystemPrompt = await run('  你是阅读助手。  ');
      expect(withSystemPrompt.messages[0]).toEqual({
        role: 'system',
        content: '你是阅读助手。',
      });

      const withoutSystemPrompt = await run('   ');
      expect(withoutSystemPrompt.messages[0]).toEqual({
        role: 'user',
        content: '天气如何',
      });
    } finally {
      await server.close();
    }
  });

  it('把思考、文本与工具调用的分片翻译成事件序列', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        toSse([
          chunk([
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: '我在想。' },
              finish_reason: null,
            },
          ]),
          chunk([{ index: 0, delta: { content: '好的，' }, finish_reason: null }]),
          chunk([
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ]),
          chunk([
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] },
              finish_reason: null,
            },
          ]),
          chunk([
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '"北京"}' } }] },
              finish_reason: null,
            },
          ]),
          chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]),
          chunk([], { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        ])
      );
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));
      const { events, final } = await collect(streamFn);

      // 块在「类型切换」或「工具调用开始」时收尾，所以 end 事件总排在下一个 start 之前
      expect(events.map(event => event.type)).toEqual([
        'start',
        'thinking_start',
        'thinking_delta',
        'thinking_end',
        'text_start',
        'text_delta',
        'text_end',
        'toolcall_start',
        'toolcall_delta',
        'toolcall_delta',
        'toolcall_end',
        'done',
      ]);

      expect(final.content).toEqual([
        { type: 'thinking', thinking: '我在想。' },
        { type: 'text', text: '好的，' },
        { type: 'toolCall', id: 'call_1', name: 'get_weather', arguments: { city: '北京' } },
      ]);
      expect(final.stopReason).toBe('toolUse');
      expect(final.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
    } finally {
      await server.close();
    }
  });

  it('接口报错时以 error 事件收尾', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-bad',
        baseUrl: server.baseUrl,
      }));
      const { events, final } = await collect(streamFn);

      expect(events.at(-1)?.type).toBe('error');
      expect(final.stopReason).toBe('error');
      expect(final.errorMessage).toContain('invalid api key');
    } finally {
      await server.close();
    }
  });

  it('未配置 apiKey 时以 error 事件收尾，且不发起请求', async () => {
    const streamFn = createOpenAiCompletionsStreamFn(() => undefined);
    const { events, final } = await collect(streamFn);

    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(final.errorMessage).toContain('未配置 apiKey');
  });

  it('按 thinkingLevelMap 下发思考级别，未声明的档位用兜底值', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toSse([chunk([{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }])]));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));
      const reasoningModel: Model<Api> = {
        ...model,
        reasoning: true,
        thinkingLevelMap: { max: 'xhigh' },
      };

      /** 跑一次请求，返回接口实际收到的 reasoning_effort */
      const run = async (options?: StreamOptions): Promise<unknown> => {
        const stream = await streamFn(reasoningModel, { messages: [userMessage] }, options);
        for await (const event of stream) void event;
        return server.lastBody().reasoning_effort;
      };

      expect(await run({ reasoning: 'max' })).toBe('xhigh');
      expect(await run({ reasoning: 'medium' })).toBe('medium');
      expect(await run({ reasoning: 'off' })).toBe('none');
      // 未给出级别时不下发该参数，由接口用默认行为
      expect(await run()).toBeUndefined();

      // 未声明对照表的模型，各档位都用兜底值
      const plain = await streamFn(model, { messages: [userMessage] }, { reasoning: 'max' });
      for await (const event of plain) void event;
      expect(server.lastBody().reasoning_effort).toBe('max');
    } finally {
      await server.close();
    }
  });

  it('把历史里的思考块作为 reasoning_content 回传', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toSse([chunk([{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }])]));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));
      const history: Message[] = [
        userMessage,
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '先想一下。' },
            { type: 'text', text: '答案是 4' },
          ],
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-reasoner',
          stopReason: 'stop',
          timestamp: 2,
        },
      ];

      const stream = await streamFn(model, { messages: history });
      for await (const event of stream) void event;

      expect(server.lastBody().messages[1]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: '答案是 4' }],
        reasoning_content: '先想一下。',
      });
    } finally {
      await server.close();
    }
  });

  it('工具结果带图片时，在这批工具消息之后补一条携带该图片的 user 消息', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toSse([chunk([{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }])]));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));
      const visionModel: Model<Api> = { ...model, input: ['text', 'image'] };
      // 一条助手消息发起两个工具调用，两条工具结果连着回来，第二条（read_image）带图
      const history: Message[] = [
        userMessage,
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '先查一下' },
            { type: 'toolCall', id: 'call_1', name: 'search_book_bm25', arguments: {} },
            { type: 'toolCall', id: 'call_2', name: 'read_image', arguments: {} },
          ],
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-chat',
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'search_book_bm25',
          content: [{ type: 'text', text: '片段结果' }],
          isError: false,
          timestamp: 3,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_2',
          toolName: 'read_image',
          content: [
            { type: 'text', text: '读取图片：images/s1/x.png（image/png）' },
            { type: 'image', path: 'images/s1/x.png', mimeType: 'image/png', data: 'QUJD' },
          ],
          isError: false,
          timestamp: 4,
        },
      ];

      const stream = await streamFn(visionModel, { messages: history });
      for await (const event of stream) void event;

      const sentMessages = server.lastBody().messages;
      // 图片不能塞进 tool 消息、也不能插在同一批工具结果之间，只能整批之后再补一条 user 消息
      expect(sentMessages.map((message: { role: string }) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'tool',
        'user',
      ]);
      expect(sentMessages[3].content).toBe('读取图片：images/s1/x.png（image/png）');
      // 图片用方括号标签标明来源，逐图标注，避免模型把它当成用户说的话
      expect(sentMessages[4].content).toEqual([
        { type: 'text', text: '[read_image 返回的图片：images/s1/x.png]' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ]);
    } finally {
      await server.close();
    }
  });

  it('把工具定义按 JSON Schema 下发给接口', async () => {
    const server = await startFakeServer(res => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toSse([chunk([{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }])]));
    });

    try {
      const streamFn = createOpenAiCompletionsStreamFn(() => ({
        apiKey: 'sk-test',
        baseUrl: server.baseUrl,
      }));
      const tools = [
        {
          name: 'get_weather',
          description: '查询天气',
          parameters: Type.Object({ city: Type.String() }),
        },
      ];
      const stream = await streamFn(model, { messages: [userMessage], tools });
      for await (const event of stream) void event;

      expect(server.lastBody().tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: '查询天气',
            parameters: {
              type: 'object',
              required: ['city'],
              properties: { city: { type: 'string' } },
            },
          },
        },
      ]);
    } finally {
      await server.close();
    }
  });
});
