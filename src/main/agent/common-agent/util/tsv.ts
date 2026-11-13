/** TSV 单元格允许的值；null / undefined 输出为空单元格。 */
export type TsvCell = string | number | boolean | null | undefined;

/**
 * 转义一个 TSV 单元格。
 *
 * TSV 没有引号转义，制表符、换行和回车会破坏行列结构，统一替换成空格。
 * 布尔值按 `true` / `false` 输出；需要紧凑表示时由调用方先转成数字或符号。
 *
 * @param value 单元格原始值
 * @returns 可直接拼进 TSV 的文本
 */
export function escapeTsvCell(value: TsvCell): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

/**
 * 生成 TSV 文本：第一行表头，之后每行一条数据。
 *
 * @param columns 列名，顺序与每行数据一致
 * @param rows 数据行；每行长度必须与 columns 相同
 * @returns 以换行分隔的 TSV 文本，末尾不带换行
 * @throws 某行列数与表头不一致时抛出，避免输出串列
 */
export function toTsv(columns: readonly string[], rows: readonly (readonly TsvCell[])[]): string {
  const lines = [columns.map(escapeTsvCell).join('\t')];

  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`TSV 行列数不一致：期望 ${columns.length} 列，实际 ${row.length} 列`);
    }
    lines.push(row.map(escapeTsvCell).join('\t'));
  }

  return lines.join('\n');
}
