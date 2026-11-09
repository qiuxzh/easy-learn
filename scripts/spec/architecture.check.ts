/**
 * 架构门禁的执行器。ESLint 的 no-restricted-imports 只把说明符字面量交给模式匹配、不做模块解析：包名目标按字面量命中，项目内目标只有在生成的字面量模式覆盖该写法时才命中，相对路径和重映射后的真实目标都不参与判断；门禁目标、tsconfig paths 目标与 from glob 的漂移也不在 lint 的职责里。
 * 这里用 TypeScript 模块解析把 import、export-from 与动态 import 的说明符还原成真实文件，再与门禁的项目路径比较（包名仍按字面量），并检查上述漂移。两层共用 ARCHITECTURE_GATES 不是重复：ESLint 负责不需要模块解析的早期反馈，这里负责解析后的最终判定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import ts from 'typescript';
import { ARCHITECTURE_GATES } from './architecture-gates.js';

export interface ForbiddenTarget {
  /** 项目内路径（src/...）或 npm 包名。 */
  to: string;
  /** 命中时展示给维护者的原因。 */
  reason: string;
  /** 为 true 时只豁免整条 import type / export type；只把 type 写在说明符上的导入（如 import { type A } from '...'）仍算违规，ESLint 的 allowTypeImports 却会放行，两层结论可能不一致。 */
  allowTypeOnly?: boolean;
}

export interface ArchitectureGate {
  name: string;
  /** 相对仓库根的源文件 glob，只在 src 下的 .ts/.tsx 中匹配。 */
  from: string[];
  forbid: ForbiddenTarget[];
}

export interface ArchitectureSpecOptions {
  /** 仓库根；测试用 fixture 时注入。 */
  root?: string;
  /** 门禁定义；测试漂移时注入。 */
  gates?: ArchitectureGate[];
}

export interface ArchitectureSpecResult {
  title: string;
  /** 为空表示通过。 */
  errors: string[];
  /** 通过时展示的规模信息。 */
  summary: string;
}

const require = createRequire(import.meta.url);

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** 返回相对仓库根的路径，和门禁 from 的坐标系一致。 */
function listSourceFiles(root: string): string[] {
  const sourceRoot = path.join(root, 'src');
  if (!fs.existsSync(sourceRoot)) return [];
  return listFiles(sourceRoot).map(file => path.relative(root, file).replace(/\\/g, '/'));
}

/** 把门禁 glob 转成正则；支持 **、*、{a,b}，其中 ** 跨任意目录。 */
function globToRegExp(glob: string): RegExp {
  let index = 0;
  let pattern = '^';
  while (index < glob.length) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 2;
        if (glob[index] === '/') {
          pattern += '(?:.*/)?';
          index += 1;
        } else {
          pattern += '.*';
        }
      } else {
        pattern += '[^/]*';
        index += 1;
      }
    } else if (char === '?') {
      pattern += '[^/]';
      index += 1;
    } else if (char === '{') {
      const end = glob.indexOf('}', index);
      if (end === -1) {
        pattern += '\\{';
        index += 1;
      } else {
        const alternatives = glob
          .slice(index + 1, end)
          .split(',')
          .map(part => part.replace(/[.+^$()|[\]\\{}?*]/g, '\\$&'));
        pattern += `(?:${alternatives.join('|')})`;
        index = end + 1;
      }
    } else {
      pattern += /[.+^$()|[\]\\{}?*]/.test(char) ? `\\${char}` : char;
      index += 1;
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}

function matchesGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}

/** 读取 tsconfig 的编译选项；读取或解析失败必须抛出，否则 paths 丢失会让 alias 无法解析、门禁静默放过这些导入。 */
function loadCompilerOptions(root: string): ts.CompilerOptions {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) {
    throw new Error(
      parsed.errors
        .map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
        .join('\n')
    );
  }
  return parsed.options;
}

/** 不以 src/ 开头的一律按 npm 包名处理。 */
function isPackageTarget(target: string): boolean {
  return !target.startsWith('src/');
}

/** 检查门禁目标是否还存在；返回 null 表示存在，否则返回漂移原因。 */
function validateTarget(target: string, root: string): string | null {
  if (isPackageTarget(target)) {
    if (builtinModules.includes(target.replace(/^node:/, ''))) return null;
    try {
      require.resolve(target);
      return null;
    } catch {
      return `门禁目标包不存在: ${target}`;
    }
  }
  return fs.existsSync(path.join(root, target)) ? null : `门禁目标路径不存在: ${target}`;
}

/** paths 指向不存在的目录时别名会静默失效，必须在扫描 import 前报漂移。 */
function validateTsconfigPaths(root: string, options: ts.CompilerOptions): string[] {
  const errors: string[] = [];
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      const base = target.replace(/\*$/, '');
      if (!fs.existsSync(path.join(root, base))) {
        errors.push(`[漂移] tsconfig paths 目标不存在: ${alias} -> ${target}`);
      }
    }
  }
  return errors;
}

/** 只收集模块说明符、是否 type-only 与行号，不解析具体绑定。 */
function collectImports(root: string, file: string) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const records: Array<{ specifier: string; typeOnly: boolean; line: number }> = [];
  const add = (node: ts.Node, specifier: string, typeOnly: boolean) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    records.push({ specifier, typeOnly, line: line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, node.importClause?.isTypeOnly === true);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node, node.moduleSpecifier.text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node, node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return records;
}

/** 用 TypeScript 的解析器得到真实文件路径；解析失败返回 undefined。 */
function resolveSpecifier(
  specifier: string,
  file: string,
  root: string,
  options: ts.CompilerOptions,
  cache: ts.ModuleResolutionCache
): string | undefined {
  return ts.resolveModuleName(specifier, path.join(root, file), options, ts.sys, cache)
    .resolvedModule?.resolvedFileName;
}

/** 包名按字面量匹配；项目路径按解析后的真实文件比较。 */
function matchesTarget(
  record: { specifier: string; typeOnly: boolean },
  target: string,
  file: string,
  root: string,
  options: ts.CompilerOptions,
  cache: ts.ModuleResolutionCache
): boolean {
  if (isPackageTarget(target)) {
    return record.specifier === target || record.specifier.startsWith(`${target}/`);
  }
  const resolved = resolveSpecifier(record.specifier, file, root, options, cache);
  if (!resolved) return false;
  const resolvedPath = path.resolve(resolved);
  const targetPath = path.join(root, target);
  return resolvedPath === targetPath || resolvedPath.startsWith(targetPath + path.sep);
}

/**
 * 运行架构门禁。tsconfig 读取或解析失败时抛出，不会带着空配置继续扫描。
 *
 * @param options.root 仓库根，默认为 process.cwd()
 * @param options.gates 门禁定义，默认为 ARCHITECTURE_GATES
 * @returns 门禁标题、错误列表与规模摘要
 * @throws tsconfig.json 无法读取或解析
 */
export function runArchitectureSpec(options: ArchitectureSpecOptions = {}): ArchitectureSpecResult {
  const root = options.root ?? process.cwd();
  const gates = options.gates ?? (ARCHITECTURE_GATES as ArchitectureGate[]);
  const sourceFiles = listSourceFiles(root);
  const compilerOptions = loadCompilerOptions(root);
  const resolutionCache = ts.createModuleResolutionCache(root, file => file, compilerOptions);
  const errors = validateTsconfigPaths(root, compilerOptions);

  for (const gate of gates) {
    const files = sourceFiles.filter(file => gate.from.some(glob => matchesGlob(file, glob)));
    // from 匹配不到任何文件说明规则已失效（glob 写错或目录不存在），必须报漂移，否则这条门禁会一直静默通过。
    if (files.length === 0) {
      errors.push(`[漂移] 门禁「${gate.name}」没有匹配到任何文件: ${gate.from.join(', ')}`);
    }
    for (const target of gate.forbid) {
      const reason = validateTarget(target.to, root);
      if (reason) errors.push(`[漂移] 门禁「${gate.name}」: ${reason}`);
    }
    for (const file of files) {
      for (const record of collectImports(root, file)) {
        for (const target of gate.forbid) {
          if (!matchesTarget(record, target.to, file, root, compilerOptions, resolutionCache))
            continue;
          // allowTypeOnly 只放过 import type，运行时代码仍然受约束。
          if (target.allowTypeOnly && record.typeOnly) continue;
          errors.push(
            `${file}:${record.line} 门禁「${gate.name}」禁止导入 ${record.specifier}：${target.reason}`
          );
        }
      }
    }
  }

  return {
    title: '架构门禁',
    errors,
    summary: `${gates.length} 组，${sourceFiles.length} 个源文件`,
  };
}
