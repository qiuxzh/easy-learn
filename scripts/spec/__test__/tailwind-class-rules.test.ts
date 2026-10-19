import { describe, expect, it } from 'vitest';
// @ts-expect-error 规则模块是普通 .js，没有类型声明（TS7016）
import { RESTRICTED_CLASSES } from '../tailwind-class-rules.js';

/** 复刻 no-restricted-classes 的判定：逐条 match，命中即拦 */
function isBlocked(className: string): boolean {
  // @ts-expect-error 放开上面那条后 RESTRICTED_CLASSES 是 any，回调参数没有上下文类型（TS7006）
  return RESTRICTED_CLASSES.some(rule => className.match(new RegExp(rule.pattern)) !== null);
}

/** 原始色阶、字面黑白、字面色值 */
const BLOCKED = [
  'bg-red-500',
  'hover:text-blue-600/50',
  'md:dark:bg-zinc-900',
  'group-hover:border-b-emerald-400',
  'bg-red-500/[0.5]',
  'border-t-red-500',
  'border-l-indigo-300',
  'divide-x-red-500',
  'divide-y-zinc-200',
  'ring-offset-red-500',
  'inset-ring-cyan-400',
  'from-rose-400',
  'via-teal-500',
  'to-violet-500',
  'fill-sky-300',
  'stroke-amber-500',
  'outline-lime-500',
  'decoration-pink-500',
  'shadow-slate-500',
  'text-white',
  'bg-black/50',
  'bg-[#ef4444]',
  'text-[rgb(15,17,21)]',
  'border-[hsl(200_50%_50%)]',
];

describe('颜色类名拦截', () => {
  it.each(BLOCKED)('拦截 %s', className => {
    expect(isBlocked(className)).toBe(true);
  });
});

describe('规则本身', () => {
  it('每条都带 pattern 与替代做法，否则命中后给不出改法', () => {
    for (const rule of RESTRICTED_CLASSES) {
      expect(rule.pattern).toBeTruthy();
      expect(rule.message).toBeTruthy();
    }
  });
});
