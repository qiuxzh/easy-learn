import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskWorkspace } from '../task-workspace';

describe('任务临时目录', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'task-work-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('创建与删除目录', () => {
    const workspace = createTaskWorkspace(root);
    workspace.create('task-1');
    expect(existsSync(path.join(root, 'task-1'))).toBe(true);

    workspace.remove('task-1');
    expect(existsSync(path.join(root, 'task-1'))).toBe(false);
  });

  it('删除不存在的目录不抛错', () => {
    const workspace = createTaskWorkspace(root);
    expect(() => workspace.remove('missing')).not.toThrow();
  });

  it('清理孤儿目录与上次未删完的退休目录', () => {
    const workspace = createTaskWorkspace(root);
    mkdirSync(path.join(root, 'keep'), { recursive: true });
    mkdirSync(path.join(root, 'orphan'), { recursive: true });
    mkdirSync(path.join(root, '.retired-x-1'), { recursive: true });

    workspace.sweep(new Set(['keep']));

    expect(existsSync(path.join(root, 'keep'))).toBe(true);
    expect(existsSync(path.join(root, 'orphan'))).toBe(false);
    expect(existsSync(path.join(root, '.retired-x-1'))).toBe(false);
  });
});
