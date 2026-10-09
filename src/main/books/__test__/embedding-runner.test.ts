/**
 * 向量化的进度估计。
 *
 * 单独拎出来测，是因为它错了不会报错——速率估歪了只是剩余时间乱跳，
 * 用户会以为程序卡住了。
 */
import { describe, expect, it, vi } from 'vitest';

// 这个模块只是为了拿到纯函数，但它顺带 import 了主进程的基础设施。
// 不 stub 掉的话，vitest 会在 node 环境里加载 electron 与 better-sqlite3。
vi.mock('electron', () => ({ net: {} }));
vi.mock('electron-log', () => ({ default: { error: () => {}, info: () => {}, warn: () => {} } }));
vi.mock('@main/config', () => ({ configService: { get: () => undefined } }));
vi.mock('@main/db', () => ({
  runInTransaction: (fn: () => unknown) => fn(),
  getRawDatabase: () => ({}),
}));
vi.mock('@main/db/repo', () => ({
  bookChunkRepo: {},
  bookRepo: {},
  embedIndexRepo: {},
  embedTaskRepo: {},
  embedVectorRepo: {},
}));

const { estimateProgress } = await import('../etl/embedding/embedding-runner');

describe('estimateProgress', () => {
  it('没有样本时给不出估计', () => {
    expect(estimateProgress([], 100)).toEqual({ rate: 0, etaMs: null });
  });

  it('样本耗时为零时给不出估计', () => {
    expect(estimateProgress([{ count: 10, elapsedMs: 0 }], 100)).toEqual({ rate: 0, etaMs: null });
  });

  it('按样本算出速率与剩余时间', () => {
    // 一批 20 个用了 2 秒 → 10 个/秒；还剩 100 个 → 10 秒
    const result = estimateProgress([{ count: 20, elapsedMs: 2000 }], 100);
    expect(result.rate).toBeCloseTo(10);
    expect(result.etaMs).toBe(10000);
  });

  it('已经做完时剩余时间为零', () => {
    const result = estimateProgress([{ count: 20, elapsedMs: 2000 }], 0);
    expect(result.etaMs).toBe(0);
  });

  it('只回看最近 5 批，被限流之后的估计会跟着降下来', () => {
    // 前 5 批很快（每批 10 个 / 100ms = 100 个/秒），最近 5 批很慢（10 个 / 1000ms = 10 个/秒）
    const samples = [
      ...Array.from({ length: 5 }, () => ({ count: 10, elapsedMs: 100 })),
      ...Array.from({ length: 5 }, () => ({ count: 10, elapsedMs: 1000 })),
    ];
    const result = estimateProgress(samples, 100);
    // 若用全程平均会得到 20 个/秒，只有窗口才看得出已经掉到 10
    expect(result.rate).toBeCloseTo(10);
  });

  it('速率不会因为剩余为零而变成 NaN', () => {
    const result = estimateProgress([{ count: 5, elapsedMs: 500 }], 0);
    expect(Number.isFinite(result.rate)).toBe(true);
  });
});
