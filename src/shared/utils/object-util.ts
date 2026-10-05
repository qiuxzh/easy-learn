/** 判断值是否为普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 复制值，避免调用方直接修改原始对象。 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
