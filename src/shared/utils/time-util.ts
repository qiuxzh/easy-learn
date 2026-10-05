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
