import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { useConfigStore } from '@/stores/config-store';
import { OCR_MODEL_LABEL } from '@shared/types/ocr';

/** 与 runner 的兜底值保持一致：配置缺省时按这里跑。 */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;
const PAGE_SIZE_LIMITS = { min: 1, max: 500 } as const;
const CONCURRENCY_LIMITS = { min: 1, max: 8 } as const;

/** 令牌的落盘延迟：逐键写配置会打满 IPC，停手后再写。 */
const TOKEN_WRITE_DELAY_MS = 400;

/**
 * 文字提取（OCR）设置：识别模型、访问令牌与分块参数。
 *
 * 所有改动即时写配置，没有保存按钮：文本输入防抖落盘，数字输入失焦时校验并写回。
 * 令牌只保存在本机 config.json。
 */
export function OcrSettings() {
  const ocr = useConfigStore(state => state.config.ocr);
  const writeConfig = useConfigStore(state => state.set);

  const initialToken = ocr?.['paddle-ocr']?.token ?? '';
  const [token, setToken] = useState(initialToken);
  const [pageSize, setPageSize] = useState(String(ocr?.pageSize ?? DEFAULT_PAGE_SIZE));
  const [concurrency, setConcurrency] = useState(String(ocr?.concurrency ?? DEFAULT_CONCURRENCY));

  /** 卸载时用来补写还没落盘的令牌；只在输入事件里更新。 */
  const tokenRef = useRef(initialToken);
  const tokenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = (path: readonly (string | number)[], value: unknown): void => {
    void writeConfig(path, value).then(error => {
      if (error) toast.error(`保存失败：${error}`);
    });
  };

  /** 立即把防抖中的令牌写掉。 */
  const flushToken = (): void => {
    if (!tokenTimer.current) return;
    clearTimeout(tokenTimer.current);
    tokenTimer.current = null;
    write(['ocr', 'paddle-ocr', 'token'], tokenRef.current.trim());
  };

  // 切走设置页时补写最后几个字符，避免防抖窗口内的输入丢失
  useEffect(
    () => () => {
      if (!tokenTimer.current) return;
      clearTimeout(tokenTimer.current);
      tokenTimer.current = null;
      void useConfigStore.getState().set(['ocr', 'paddle-ocr', 'token'], tokenRef.current.trim());
    },
    []
  );

  function handleTokenChange(value: string): void {
    setToken(value);
    tokenRef.current = value;

    if (tokenTimer.current) clearTimeout(tokenTimer.current);
    tokenTimer.current = setTimeout(() => {
      tokenTimer.current = null;
      write(['ocr', 'paddle-ocr', 'token'], value.trim());
    }, TOKEN_WRITE_DELAY_MS);
  }

  /** 失焦时把数字夹到范围内并写回；非法输入退回默认值。 */
  function commitNumber(
    field: 'pageSize' | 'concurrency',
    raw: string,
    fallback: number,
    limits: { min: number; max: number }
  ): void {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, limits.min), limits.max)
      : fallback;
    const current =
      field === 'pageSize'
        ? (ocr?.pageSize ?? DEFAULT_PAGE_SIZE)
        : (ocr?.concurrency ?? DEFAULT_CONCURRENCY);

    if (field === 'pageSize') setPageSize(String(next));
    else setConcurrency(String(next));

    if (next !== current) write(['ocr', field], next);
  }

  const hasToken = token.trim().length > 0;

  return (
    <div className="rounded-lg border border-stroke-3 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">识别模型</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            百度 PaddleOCR 的文档解析模型，由官方云端服务提供。每日免费额度充足。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium">{OCR_MODEL_LABEL}</span>
          <a
            href="https://aistudio.baidu.com/paddleocr"
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-2"
          >
            官网
          </a>
        </div>
      </div>

      <div className="mt-3 border-t border-stroke-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">访问令牌</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              在 AI Studio 控制台创建，只保存在本机配置里。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" tone={hasToken ? 'success' : 'warn'}>
              {hasToken ? '已配置' : '未配置'}
            </Badge>
            <PasswordInput
              value={token}
              onChange={event => handleTokenChange(event.target.value)}
              onBlur={flushToken}
              placeholder="粘贴访问令牌"
              autoComplete="off"
              spellCheck={false}
              className="w-64"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-stroke-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">分块页数</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              每个上传分块包含的页数。越小上传越快、失败重来的代价越小。
            </p>
          </div>
          <Input
            type="number"
            min={PAGE_SIZE_LIMITS.min}
            max={PAGE_SIZE_LIMITS.max}
            value={pageSize}
            onChange={event => setPageSize(event.target.value)}
            onBlur={() => commitNumber('pageSize', pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_LIMITS)}
            className="w-20 shrink-0 text-right"
          />
        </div>
      </div>

      <div className="mt-3 border-t border-stroke-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">同时上传块数</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              并发过高可能触发服务端限流。
            </p>
          </div>
          <Input
            type="number"
            min={CONCURRENCY_LIMITS.min}
            max={CONCURRENCY_LIMITS.max}
            value={concurrency}
            onChange={event => setConcurrency(event.target.value)}
            onBlur={() =>
              commitNumber('concurrency', concurrency, DEFAULT_CONCURRENCY, CONCURRENCY_LIMITS)
            }
            className="w-20 shrink-0 text-right"
          />
        </div>
      </div>
    </div>
  );
}
