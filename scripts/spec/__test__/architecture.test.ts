import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArchitectureSpec } from '../architecture.check';
import type { ArchitectureGate } from '../architecture.check';

const roots: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-spec-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function baseFiles(): Record<string, string> {
  return {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        baseUrl: '.',
        paths: { '@main/*': ['src/main/*'] },
      },
    }),
    'src/main/books/a.ts': 'export const a = 1;',
    'src/main/infra/db/connection.ts': 'export const connection = 1;',
  };
}

function gate(from: string, to: string, allowTypeOnly = false): ArchitectureGate {
  return {
    name: '测试门禁',
    from: [from],
    forbid: [{ to, reason: '测试原因', allowTypeOnly }],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('runArchitectureSpec', () => {
  it('通过时返回空错误列表', () => {
    const root = makeFixture(baseFiles());
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/books/**/*.ts', 'src/main/infra/db')],
    });
    expect(result.errors).toEqual([]);
  });

  it('能识别相对导入绕过的门禁', () => {
    const root = makeFixture({
      ...baseFiles(),
      'src/main/infra/db/connection.ts': 'export const connection = 1;',
      'src/main/books/a.ts': "import '../infra/db/connection';",
    });
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/books/**/*.ts', 'src/main/infra/db')],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('禁止导入');
  });

  it('from 的 ** 能匹配深层目录', () => {
    const root = makeFixture({
      ...baseFiles(),
      'src/main/books/etl/pdf/a.ts': "import '../../../infra/db/connection';",
    });
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/books/**/*.ts', 'src/main/infra/db')],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('禁止导入');
  });

  it('allowTypeOnly 允许 type-only 导入', () => {
    const root = makeFixture({
      ...baseFiles(),
      'src/main/infra/repo/repos.ts': 'export type Repo = { id: string };',
      'src/main/books/a.ts': "import type { Repo } from '../infra/repo/repos';",
    });
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/books/**/*.ts', 'src/main/infra/repo', true)],
    });
    expect(result.errors).toEqual([]);
  });

  it('门禁目标不存在时报告漂移', () => {
    const root = makeFixture(baseFiles());
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/books/**/*.ts', 'src/main/not-exists')],
    });
    expect(result.errors.some(error => error.includes('[漂移]'))).toBe(true);
    expect(result.errors.some(error => error.includes('门禁目标路径不存在'))).toBe(true);
  });

  it('门禁 from 没有匹配文件时报告漂移', () => {
    const root = makeFixture(baseFiles());
    const result = runArchitectureSpec({
      root,
      gates: [gate('src/main/not-exists/**/*.ts', 'src/main/infra/db')],
    });
    expect(result.errors.some(error => error.includes('没有匹配到任何文件'))).toBe(true);
  });

  it('tsconfig paths 目标不存在时报告漂移', () => {
    const root = makeFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          baseUrl: '.',
          paths: { '@missing/*': ['src/missing/*'] },
        },
      }),
      'src/main/books/a.ts': 'export const a = 1;',
    });
    const result = runArchitectureSpec({ root, gates: [] });
    expect(result.errors.some(error => error.includes('tsconfig paths 目标不存在'))).toBe(true);
  });
});
