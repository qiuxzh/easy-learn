import { describe, it, expect } from 'vitest';
import { Type } from 'typebox';
import assert from 'assert';
import type { StreamFn } from '../../model/stream-fn';
import { createFauxStreamFn, fauxMessage, fauxText, fauxToolCall } from './faux';
import { Agent, DEFAULT_MODEL, type AgentTool } from '../agent';

const unusedStreamFunction: StreamFn = () => {
  throw new Error('Unexpected stream call');
};

describe('Agent', () => {
  it('测试默认state状态，防止初始状态被改动', () => {
    const agent = new Agent({ streamFn: unusedStreamFunction });
    expect(agent.state).toBeDefined();
    expect(agent.state.systemPrompt).toBe('');
    expect(agent.state.model).toBeDefined();
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.pendingToolCalls).toEqual(new Set());
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.errorMessage).toBeUndefined();
    expect(agent.state.streamingMessage).toBe(undefined);
    expect(agent.state.thinkingLevel).toBe('medium');
  });

  it('测试传入初始化状态的state状态', () => {
    const agent = new Agent({
      streamFn: unusedStreamFunction,
      initialState: {
        systemPrompt: 'You are a helpful assistant.',
        model: DEFAULT_MODEL,
        thinkingLevel: 'max',
      },
    });
    expect(agent.state.systemPrompt).toBe('You are a helpful assistant.');
    expect(agent.state.model).toBe(DEFAULT_MODEL);
    expect(agent.state.thinkingLevel).toBe('max');
  });

  it('测试StreamFn抛错', async () => {
    const agent = new Agent({
      streamFn: () => {
        throw new Error('provider exploded');
      },
    });
    // 收集事件
    const events: string[] = [];
    agent.subscribe(event => {
      events.push(event.type);
    });

    await agent.prompt('hello');
    expect(events).toEqual([
      'agent_start',
      'turn_start',
      'message_start', // 用户message
      'message_end',
      'message_start', // error 的 system message
      'message_end',
      'turn_end',
      'agent_end',
    ]);
    const lastMessage = agent.state.messages[agent.state.messages.length - 1];
    expect(lastMessage?.role).toBe('assistant');
    // 收窄类型，lastMessage为 AssistantMessage类型
    assert(lastMessage?.role === 'assistant', 'Expected assistant message');
    expect(lastMessage.stopReason).toBe('error');
    expect(lastMessage.errorMessage).toBe('provider exploded');
  });

  it('一次普通对话能走完，并把用户与助手消息落进 messages', async () => {
    // 假流按 delta 逐片推入，chunkSize 决定切片粒度
    const streamFn = createFauxStreamFn([fauxMessage('答案是 4')], { chunkSize: 2 });

    const agent = new Agent({ streamFn });
    const events: string[] = [];
    agent.subscribe(event => {
      events.push(event.type);
    });

    await agent.prompt('2 + 2 等于几？');

    // 流式过程中会有多次 message_update
    expect(events).toContain('message_update');
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.map(message => message.role)).toEqual(['user', 'assistant']);

    const assistant = agent.state.messages[1];
    assert(assistant.role === 'assistant', 'Expected assistant message');
    expect(assistant.content).toEqual([{ type: 'text', text: '答案是 4' }]);
    expect(assistant.stopReason).toBe('stop');
    expect(agent.state.errorMessage).toBeUndefined();
  });

  it('用户问天气时，Agent 调用工具并执行，再把结果回传给模型', async () => {
    // 工具：查询指定城市当前的天气
    const weatherParameters = Type.Object({ city: Type.String() });
    const weatherTool: AgentTool<typeof weatherParameters> = {
      name: 'get_weather',
      description: '查询指定城市当前的天气',
      parameters: weatherParameters,
      execute: async (_toolCallId, params) => ({
        content: [{ type: 'text', text: `${params.city}：晴，25℃` }],
        details: undefined,
      }),
    };

    // 假流脚本：第一次要求调工具，第二次基于工具结果作答
    const streamFn = createFauxStreamFn([
      fauxMessage(
        [
          fauxText('我查一下北京今天的天气。'),
          fauxToolCall('get_weather', { city: '北京' }, { id: 'call-1' }),
        ],
        { stopReason: 'toolUse' }
      ),
      fauxMessage('北京今天晴，25℃。'),
    ]);

    const agent = new Agent({
      streamFn,
      initialState: {
        systemPrompt: 'You are a helpful assistant.',
        tools: [weatherTool],
      },
    });

    const events: string[] = [];
    agent.subscribe(event => {
      events.push(event.type);
    });

    await agent.prompt('今天天气如何？');

    // 模型被请求了两次：一次要求调工具，一次基于工具结果作答
    expect(streamFn.contexts).toHaveLength(2);

    // 第二次请求的上下文里带上了工具执行结果
    const toolResult = streamFn.contexts[1].messages.find(message => message.role === 'toolResult');
    assert(toolResult?.role === 'toolResult', 'Expected tool result message');
    expect(toolResult.toolName).toBe('get_weather');
    expect(toolResult.content).toEqual([{ type: 'text', text: '北京：晴，25℃' }]);
    expect(toolResult.isError).toBe(false);

    // 工具执行事件确实发了出来
    expect(events).toContain('tool_execution_start');
    expect(events).toContain('tool_execution_end');

    // 落进 state 的消息序列
    expect(agent.state.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);

    // 最终回答
    const lastMessage = agent.state.messages.at(-1);
    assert(lastMessage?.role === 'assistant', 'Expected assistant message');
    expect(lastMessage.content).toEqual([{ type: 'text', text: '北京今天晴，25℃。' }]);
    expect(agent.state.pendingToolCalls.size).toBe(0);
    expect(agent.state.isStreaming).toBe(false);
  });
});
