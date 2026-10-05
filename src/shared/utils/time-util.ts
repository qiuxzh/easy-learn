/** 人性化时间格式化 */
export function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const second = 1000;
  const minute = second * 60;
  const hour = minute * 60;
  const day = hour * 24;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  } else if (diff < day * 2) {
    return '昨天';
  } else if (diff < day * 7) {
    return `${Math.floor(diff / day)} 天前`;
  } else {
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const dayNum = date.getDate();
    return `${month} 月 ${dayNum} 日`;
  }
}

/** 数字补零到两位，用于拼接固定宽度的日期时间。 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 把毫秒时间戳格式化为本地时区的绝对时间，形如"2025-11-20 09:30"。
 * 不使用 toLocaleString：它随运行环境的 locale 变化，输出宽度不固定也不便解析。
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 把毫秒时间戳格式化为相对当前时间的描述，形如"3 天前"或"2 小时后"。
 * 与 formatTime 的区别：本函数按真实时间差分档（分钟/小时/天），
 * 且同时支持未来时间，适合表达复习到期这类可能尚未到达的时间点。
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const past = diff >= 0;
  const minutes = Math.floor(Math.abs(diff) / 60000);
  if (minutes < 1) return '刚刚';

  const units: Array<[number, string]> = [
    [1440, '天'],
    [60, '小时'],
    [1, '分钟'],
  ];
  for (const [minutesPerUnit, unit] of units) {
    if (minutes >= minutesPerUnit) {
      const amount = Math.floor(minutes / minutesPerUnit);
      return past ? `${amount} ${unit}前` : `${amount} ${unit}后`;
    }
  }
  return past ? '刚刚' : '即将';
}

/**
 * 把毫秒时间戳格式化为"绝对时间（相对时间）"的组合，便于阅读同时也保留精确定位。
 * 传入 null 时返回"从未"，用于表达"尚无记录"而非数据缺失。
 */
export function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) return '从未';
  return `${formatDateTime(timestamp)}（${formatRelativeTime(timestamp)}）`;
}
