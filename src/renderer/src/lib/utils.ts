import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge 不认识自定义字号，会把 text-body 当成文字颜色，
 * 于是与 text-primary-foreground 这类颜色类互相覆盖，丢掉的可能是字号也可能是颜色。
 * 这里把自定义字号登记进 font-size 组，颜色与字号各归各组。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['body', 'body-lg'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
