/**
 * spec 聚合入口：执行本目录下所有 *.check.ts，每个模块必须导出 runArchitectureSpec() 并返回 { title, errors, summary }。
 * 任一检查返回非空 errors 或缺少导出时退出码为 1；检查抛出的异常不被捕获，会中断其余检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SPEC_DIR = import.meta.dirname;
const checks = fs
  .readdirSync(SPEC_DIR)
  .filter(file => file.endsWith('.check.ts'))
  .sort();

let failed = false;
for (const file of checks) {
  const module = await import(pathToFileURL(path.join(SPEC_DIR, file)).href);
  if (typeof module.runArchitectureSpec !== 'function') {
    failed = true;
    console.error(`${file} 没有导出 runArchitectureSpec()`);
    continue;
  }
  const result = module.runArchitectureSpec();
  if (result.errors.length > 0) {
    failed = true;
    console.error(`${result.title}失败（${result.errors.length} 项）：`);
    for (const error of result.errors) console.error(`- ${error}`);
  } else {
    console.log(`${result.title}通过：${result.summary}`);
  }
}

if (failed) process.exitCode = 1;
