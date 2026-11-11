import { APIError, AuthError, NetworkError, RateLimitError } from '@paddleocr/api-sdk';
import { describe, expect, it } from 'vitest';
import { isRetryableOcrError } from '../paddle/client';

describe('isRetryableOcrError', () => {
  it('限流、网络与 5xx 可重试', () => {
    expect(isRetryableOcrError(new RateLimitError('限流'))).toBe(true);
    expect(isRetryableOcrError(new NetworkError('断网'))).toBe(true);
    expect(isRetryableOcrError(new APIError(500, '服务内部错误'))).toBe(true);
    expect(isRetryableOcrError(new APIError(503, '服务不可用'))).toBe(true);
  });

  it('鉴权与 4xx 不重试', () => {
    expect(isRetryableOcrError(new AuthError('鉴权失败'))).toBe(false);
    expect(isRetryableOcrError(new APIError(400, '参数非法'))).toBe(false);
    expect(isRetryableOcrError(new APIError(404, '不存在'))).toBe(false);
  });
});
