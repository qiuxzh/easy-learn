/**
 * 书籍向量化状态的推导。
 *
 * 这段逻辑**只在渲染层跑**，主进程不参与——数据轴还要看用户当前选了哪个模型。
 * 所以它放在 shared 里当纯函数测。
 *
 * 推错了不会报错：一本需要重新向量化的书显示成「已向量化」，用户就找不到该点哪个按钮。
 */
import { describe, expect, it } from 'vitest';
import {
  deriveDataState,
  describeEmbedding,
  isStale,
  resolveDisplayCounts,
  resolveEmbeddingState,
} from '@shared/utils/embedding-state';
import type { BookEmbedding } from '@shared/types/books';
import type { EmbeddingRuntime } from '@shared/types/embedding';
import type { EmbeddingIdentity } from '@shared/utils/embedding-identity';
import { modelFingerprint } from '@shared/utils/embedding-identity';

const CURRENT: EmbeddingIdentity = { endpoint: 'https://a/v1/embeddings', modelId: 'm' };
const OTHER: EmbeddingIdentity = { endpoint: 'https://b/v1/embeddings', modelId: 'n' };
const CURRENT_FINGERPRINT = modelFingerprint(CURRENT);
const OTHER_FINGERPRINT = modelFingerprint(OTHER);

const IDLE: EmbeddingRuntime = { current: null, queue: [] };

/** 造一份书籍的向量化信息。 */
function embedding(overrides: Partial<BookEmbedding> = {}): BookEmbedding {
  return {
    total: 100,
    done: 0,
    modelFingerprint: null,
    lastError: null,
    ...overrides,
  };
}

describe('deriveDataState', () => {
  it('从没索引过算未向量化', () => {
    expect(deriveDataState(embedding(), CURRENT)).toBe('none');
  });

  it('当前模型下做完了算已向量化', () => {
    const book = embedding({ done: 100, modelFingerprint: CURRENT_FINGERPRINT });
    expect(deriveDataState(book, CURRENT)).toBe('done');
  });

  it('做了一半算未向量化', () => {
    const book = embedding({ done: 40, modelFingerprint: CURRENT_FINGERPRINT });
    expect(deriveDataState(book, CURRENT)).toBe('none');
  });

  it('向量是别的模型生成的算未向量化', () => {
    const book = embedding({ done: 100, modelFingerprint: OTHER_FINGERPRINT });
    expect(deriveDataState(book, CURRENT)).toBe('none');
  });

  it('没选中模型时一律算未向量化', () => {
    const book = embedding({ done: 100, modelFingerprint: CURRENT_FINGERPRINT });
    expect(deriveDataState(book, null)).toBe('none');
  });

  it('没有分片时不算已向量化', () => {
    // 少了 total > 0 这道闸，0 >= 0 会让一本空书显示成「已向量化」
    const book = embedding({ total: 0, done: 0, modelFingerprint: CURRENT_FINGERPRINT });
    expect(deriveDataState(book, CURRENT)).toBe('none');
  });
});

describe('isStale', () => {
  it('从没索引过时不算过期', () => {
    expect(isStale(embedding(), CURRENT)).toBe(false);
  });

  it('向量属于别的模型时算过期', () => {
    const book = embedding({ done: 100, modelFingerprint: OTHER_FINGERPRINT });
    expect(isStale(book, CURRENT)).toBe(true);
  });

  it('向量属于当前模型时不算过期', () => {
    const book = embedding({ done: 40, modelFingerprint: CURRENT_FINGERPRINT });
    expect(isStale(book, CURRENT)).toBe(false);
  });

  it('没选中模型时，有向量就算过期', () => {
    const book = embedding({ done: 100, modelFingerprint: CURRENT_FINGERPRINT });
    expect(isStale(book, null)).toBe(true);
  });

  it('没选中模型、也没向量时不算过期', () => {
    expect(isStale(embedding(), null)).toBe(false);
  });
});

describe('describeEmbedding', () => {
  it('从没做过时没有附注', () => {
    expect(describeEmbedding(embedding(), CURRENT)).toHaveLength(0);
  });

  it('向量属于别的模型时说明会先删掉', () => {
    const notes = describeEmbedding(
      embedding({ done: 100, modelFingerprint: OTHER_FINGERPRINT }),
      CURRENT
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('不是当前模型生成的');
  });

  it('上次失败过时带上原因', () => {
    const notes = describeEmbedding(embedding({ lastError: 'HTTP 429' }), CURRENT);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('HTTP 429');
  });

  it('换了模型又失败过时两条都在', () => {
    const book = embedding({
      done: 10,
      modelFingerprint: OTHER_FINGERPRINT,
      lastError: 'HTTP 429',
    });
    expect(describeEmbedding(book, CURRENT)).toHaveLength(2);
  });

  it('属于当前模型的失败原因也会带上', () => {
    const book = embedding({
      done: 10,
      modelFingerprint: CURRENT_FINGERPRINT,
      lastError: 'HTTP 429',
    });
    expect(describeEmbedding(book, CURRENT)).toHaveLength(1);
  });
});

describe('resolveEmbeddingState', () => {
  const book = embedding({ done: 100, modelFingerprint: CURRENT_FINGERPRINT });

  it('没有任务时落到数据轴', () => {
    expect(resolveEmbeddingState(book, 'book-1', CURRENT, IDLE)).toBe('done');
  });

  it('当前任务的书用运行轴的阶段', () => {
    const running: EmbeddingRuntime = {
      current: { bookId: 'book-1', phase: 'running', total: 100, done: 5, rate: 0, etaMs: null },
      queue: [],
    };
    expect(resolveEmbeddingState(book, 'book-1', CURRENT, running)).toBe('running');
  });

  it('暂停时用 paused，不会被后推的进度覆盖', () => {
    // 暂停请求是在批次中途发出的，那一批跑完后还会再推一次进度。
    // 状态取自 phase 而不是进度事件，所以它不会退回 running
    const paused: EmbeddingRuntime = {
      current: { bookId: 'book-1', phase: 'paused', total: 100, done: 5, rate: 0, etaMs: null },
      queue: [],
    };
    expect(resolveEmbeddingState(book, 'book-1', CURRENT, paused)).toBe('paused');
  });

  it('在队列里算排队中，即使它已经做完过', () => {
    const queued: EmbeddingRuntime = { current: null, queue: ['book-1'] };
    expect(resolveEmbeddingState(book, 'book-1', CURRENT, queued)).toBe('queued');
  });

  it('别的书在跑时不影响这本书', () => {
    const other: EmbeddingRuntime = {
      current: { bookId: 'book-2', phase: 'running', total: 10, done: 1, rate: 0, etaMs: null },
      queue: [],
    };
    expect(resolveEmbeddingState(book, 'book-1', CURRENT, other)).toBe('done');
  });
});

describe('resolveDisplayCounts', () => {
  it('运行中用实时数字', () => {
    const runtime: EmbeddingRuntime = {
      current: { bookId: 'book-1', phase: 'running', total: 100, done: 7, rate: 0, etaMs: null },
      queue: [],
    };
    expect(resolveDisplayCounts(embedding(), 'book-1', CURRENT, runtime)).toEqual({
      total: 100,
      done: 7,
    });
  });

  it('向量属于别的模型时完成数按 0 显示', () => {
    // 那 100 条在当前模型下用不了，显示成 100 会让人以为已经能用
    const book = embedding({ done: 100, modelFingerprint: OTHER_FINGERPRINT });
    expect(resolveDisplayCounts(book, 'book-1', CURRENT, IDLE)).toEqual({ total: 100, done: 0 });
  });

  it('属于当前模型时照实显示', () => {
    const book = embedding({ done: 40, modelFingerprint: CURRENT_FINGERPRINT });
    expect(resolveDisplayCounts(book, 'book-1', CURRENT, IDLE)).toEqual({ total: 100, done: 40 });
  });
});
