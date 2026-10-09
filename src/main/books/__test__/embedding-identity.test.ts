/**
 * 模型身份的判定。
 *
 * 这段逻辑**两端共用**：主进程用它做注册表唯一键与向量表名后缀，渲染层用它判断
 * 「索引失效」。两边必须逐字节一致，否则界面会显示「已索引」而实际查不到对应的向量，
 * 而且不会报错。
 *
 * 最要紧的一条是**指纹不能变**：库里已经存着一批按旧算法算出来的指纹，
 * 算法一改，那些索引就再也匹配不上，向量表会变成孤儿。所以下面拿 `node:crypto`
 * 当参照物逐个比对。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VECTOR_DISTANCE, isSameModel, modelFingerprint } from '@shared/utils/embedding-identity';

/** 用 node:crypto 复刻一份「改算法之前」的拼装，作为参照。 */
function referenceFingerprint(endpoint: string, modelId: string): string {
  const url = new URL(endpoint.trim());
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path === '' ? '/' : path;
  const normalized = url.toString().replace(/\/+$/, '');

  const hash = createHash('sha256');
  for (const component of [
    'learn-app-embedding',
    '1',
    VECTOR_DISTANCE,
    normalized,
    modelId.trim(),
  ]) {
    hash.update(component, 'utf8');
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

describe('modelFingerprint', () => {
  it('自实现的 sha256 与 node:crypto 逐字节一致', () => {
    // 覆盖跨块（> 64 字节）与不跨块两种长度，块边界上的填充最容易写错
    const cases: Array<[string, string]> = [
      ['https://api.example.com/v1/embeddings', 'bge-m3'],
      ['http://127.0.0.1:11434/api/embeddings', 'nomic-embed-text'],
      ['https://api.siliconflow.cn/v1/embeddings', 'Qwen/Qwen3-VL-Embedding-8B'],
      ['https://a', 'x'],
      ['https://' + 'a'.repeat(120) + '/v1/embeddings', 'm'.repeat(80)],
    ];
    for (const [endpoint, modelId] of cases) {
      expect(modelFingerprint({ endpoint, modelId })).toBe(referenceFingerprint(endpoint, modelId));
    }
  });

  it('同一套参数永远得到同一个值', () => {
    const first = modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'm' });
    const second = modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'm' });
    expect(first).toBe(second);
  });

  it('末尾斜杠、查询串、锚点、凭据都不影响身份', () => {
    const base = modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'm' });
    expect(modelFingerprint({ endpoint: 'https://a/v1/embeddings/', modelId: 'm' })).toBe(base);
    expect(modelFingerprint({ endpoint: 'https://a/v1/embeddings?x=1', modelId: 'm' })).toBe(base);
    expect(modelFingerprint({ endpoint: 'https://a/v1/embeddings#f', modelId: 'm' })).toBe(base);
    expect(modelFingerprint({ endpoint: 'https://u:p@a/v1/embeddings', modelId: 'm' })).toBe(base);
  });

  it('主机名折叠大小写，但路径保留大小写', () => {
    const base = modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'm' });
    expect(modelFingerprint({ endpoint: 'https://A/v1/embeddings', modelId: 'm' })).toBe(base);
    // 路径大小写敏感：折叠它会把两个不同的服务当成同一个
    expect(modelFingerprint({ endpoint: 'https://a/V1/embeddings', modelId: 'm' })).not.toBe(base);
  });

  it('换地址或换模型标识都会改变身份', () => {
    const base = modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'm' });
    expect(modelFingerprint({ endpoint: 'https://b/v1/embeddings', modelId: 'm' })).not.toBe(base);
    expect(modelFingerprint({ endpoint: 'https://a/v1/embeddings', modelId: 'n' })).not.toBe(base);
  });

  it('解析不了的地址退化为纯文本，不抛错', () => {
    expect(() => modelFingerprint({ endpoint: '不是地址', modelId: 'm' })).not.toThrow();
  });
});

describe('isSameModel', () => {
  const current = { endpoint: 'https://a/v1/embeddings', modelId: 'm' };

  it('指纹为空时判定为不同', () => {
    expect(isSameModel(null, current)).toBe(false);
  });

  it('指纹相同判定为同一个', () => {
    expect(isSameModel(modelFingerprint(current), current)).toBe(true);
  });

  it('换了模型判定为不同', () => {
    expect(
      isSameModel(modelFingerprint({ endpoint: 'https://b/v1/embeddings', modelId: 'm' }), current)
    ).toBe(false);
  });

  it('地址写法不同但等价时仍判定为同一个', () => {
    const messy = modelFingerprint({ endpoint: 'https://a/v1/embeddings/', modelId: ' m ' });
    expect(isSameModel(messy, current)).toBe(true);
  });
});
