/**
 * 当前该用哪套模型参数。
 *
 * 它把「配置」与「注册表」合起来解析成一个可以直接用的身份：地址、模型标识、密钥、指纹，
 * 以及这套参数在注册表里的索引（首次使用时为 null）。
 *
 * 单独成模块而不是留在编排层里，是因为它被三处用到——编排（每个批次边界检测配置变更）、
 * 服务层（启动前检查有没有模型）。留在编排层里会让查询层反向依赖它。
 */
import { configService } from '@main/config';
import { embedIndexRepo } from '@main/db/repo';
import { modelFingerprint, type EmbeddingIdentity } from '@shared/utils/embedding-identity';

/** 配置里选中的那一套模型参数。 */
export interface ActiveEntry {
  /** 配置里的键名 */
  label: string;
  endpoint: string;
  modelId: string;
  apiKey?: string;
}

/** 已建索引的物理信息。 */
export interface EmbedIndexRef {
  id: number;
  tableName: string;
  dimension: number;
}

/**
 * 已解析并快照下来的模型身份。
 *
 * 任务一开始就定下来，运行期间不再读配置——中途改配置不该影响正在跑的任务，
 * 否则写到一半会换表，前半段的向量就留在了旧表里。
 */
export interface ResolvedModel {
  /** 模型身份摘要，决定向量表名与注册表唯一键 */
  fingerprint: string;
  endpoint: string;
  modelId: string;
  apiKey?: string;
  /** 配置里的键名，仅用于展示 */
  label: string;
  /** 已经建过索引时存在；首次使用这套模型参数时为 null */
  index: EmbedIndexRef | null;
}

/** 读配置里选中的那一项；没有选中、或字段不全时返回 null。不查库。 */
export function readActiveEntry(): ActiveEntry | null {
  const embedding = configService.get('embedding');
  const selected = embedding?.selected?.trim();
  if (!selected) return null;

  const entry = embedding?.models?.[selected];
  if (!entry) return null;

  const endpoint = entry.endpoint.trim();
  const modelId = entry.modelId.trim();
  if (!endpoint || !modelId) return null;

  return { label: selected, endpoint, modelId, apiKey: entry.apiKey };
}

/**
 * 配置 ＋ 注册表 → 当前该用哪套模型参数。
 * 没有配置、或选中的键不存在时返回 null——调用方据此提示用户先去设置页。
 */
export function resolveActiveModel(): ResolvedModel | null {
  const entry = readActiveEntry();
  if (!entry) return null;

  const fingerprint = modelFingerprint({ endpoint: entry.endpoint, modelId: entry.modelId });
  const row = embedIndexRepo.findByFingerprint(fingerprint);
  return {
    ...entry,
    fingerprint,
    index: row ? { id: row.id, tableName: row.tableName, dimension: row.dimension } : null,
  };
}
