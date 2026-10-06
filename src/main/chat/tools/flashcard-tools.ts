import { Type } from 'typebox';
import { defineSessionTool } from '@main/agent/common-agent/agent-definition';
import { flashcardService } from '@main/service/flashcard-service';
import type {
  CardFields,
  CardRecord,
  CardResult,
  FlashcardChangeDetail,
  FlashcardChangeField,
  FlashcardChangeSnapshot,
} from '@shared/types/flashcards';
import { flashcardRepo, toCardRecord } from '@main/db/repo/flashcard-repo';
import { formatTimestamp } from '@shared/utils/time-util';

/** 摘要文本的最大字符数，避免回执把整段正文灌进上下文。 */
const SUMMARY_MAX_LENGTH = 60;

/** 取一段文本的短摘要，超长时截断并追加省略号。 */
function summarize(text: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > SUMMARY_MAX_LENGTH ? plain.slice(0, SUMMARY_MAX_LENGTH) + '…' : plain;
}

/** 工具回执中使用的卡片摘要：只给定位信息与正面摘要，不含反面全文。 */
function toCardSummary(card: CardRecord) {
  return {
    id: card.id,
    groupId: card.groupId,
    front: summarize(card.fields.front),
    tags: card.tags,
    state: card.state,
    due: formatTimestamp(card.due),
    createdAt: formatTimestamp(card.createdAt),
    updatedAt: formatTimestamp(card.updatedAt),
  };
}

/**
 * 取出服务层返回的卡片，失败时抛错。
 * 内核要求工具失败时抛出异常，而不是把错误编码进 content（见 AgentTool.execute）。
 */
function unwrap(result: CardResult, fallbackMessage: string): CardRecord {
  if (!result.success || !result.card) {
    throw new Error(result.error ?? fallbackMessage);
  }
  return result.card;
}

/**
 * 查牌组名并作为快照的一部分保存。
 * 快照只存名称不存 ID：渲染层要显示的就是名称，牌组不存在时回退到 ID 保证有可展示的值。
 */
function resolveGroupName(groupId: string): string {
  return flashcardRepo.findGroupById(groupId)?.name ?? groupId;
}

/** 从卡片记录提取渲染层展示用的快照，保留正反面全文。 */
function toChangeSnapshot(card: CardRecord): FlashcardChangeSnapshot {
  return {
    id: card.id,
    groupName: resolveGroupName(card.groupId),
    front: card.fields.front,
    back: card.fields.back,
    tags: card.tags,
  };
}

/** 判断两个标签数组是否等价，忽略顺序。 */
function isSameTags(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((tag, index) => tag === sortedRight[index]);
}

/**
 * 比较修改前后的卡片，得出实际变化的字段及其旧值。
 * 用保存后的结果与修改前比较，因此能反映标签去空格、去重等归一化带来的真实变化。
 */
function diffCard(
  before: CardRecord,
  after: CardRecord
): Pick<FlashcardChangeDetail, 'changedFields' | 'previous'> {
  const changedFields: FlashcardChangeField[] = [];
  const previous: FlashcardChangeDetail['previous'] = {};

  if (before.fields.front !== after.fields.front) {
    changedFields.push('front');
    previous.front = before.fields.front;
  }
  if (before.fields.back !== after.fields.back) {
    changedFields.push('back');
    previous.back = before.fields.back;
  }
  // 按 ID 判断是否换了牌组，但存进快照的是名称（渲染层只认名称）
  if (before.groupId !== after.groupId) {
    changedFields.push('groupName');
    previous.groupName = resolveGroupName(before.groupId);
  }
  if (!isSameTags(before.tags, after.tags)) {
    changedFields.push('tags');
    previous.tags = before.tags;
  }

  return { changedFields, previous };
}

/** 新增闪卡：复习进度由服务层按 FSRS 初始化。 */
const createFlashcardTool = defineSessionTool({
  name: 'create_flashcard',
  description:
    '在指定牌组中新建一张闪卡，正反面内容使用 Markdown。复习进度由系统按 FSRS 自动初始化，无需提供。' +
    '需要新增多张时应逐张调用本工具。',
  promptSnippet: '新增一张闪卡',
  promptGuidelines: [
    'create_flashcard 的 groupId 必须来自真实存在的牌组，不要凭空编造 id。',
    '用户要求把内容整理成多张闪卡时，每张卡片单独调用一次 create_flashcard。',
    '尽量复用现有tag，不要轻易新增tag',
  ],
  parameters: Type.Object({
    groupId: Type.String({ minLength: 1, description: '所属牌组的 id' }),
    front: Type.String({ minLength: 1, description: '卡片正面内容，Markdown 格式' }),
    back: Type.String({ minLength: 1, description: '卡片反面内容，Markdown 格式' }),
    tags: Type.Optional(Type.Array(Type.String(), { description: '卡片标签，默认无标签' })),
  }),
  async execute(_toolCallId, params) {
    const fields: CardFields = { front: params.front, back: params.back };
    const card = unwrap(
      flashcardService.saveCard({
        groupId: params.groupId,
        fields,
        tags: params.tags ?? [],
      }),
      '新增闪卡失败'
    );

    const details: FlashcardChangeDetail = { action: 'create', card: toChangeSnapshot(card) };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(toCardSummary(card)) }],
      details,
    };
  },
});

/** 编辑闪卡：只改动传入的字段，未传入的保持原值。
 *  TODO inputschema应该传入old值，当old与当前值不一样时说明被用户修改了，下次AI再更新闪卡时可能会覆盖用户的改动
 * */
const updateFlashcardTool = defineSessionTool({
  name: 'update_flashcard',
  description:
    '修改已有闪卡的正面、反面、标签或所属牌组。只需传入要改动的字段，未传入的字段保持原值；' +
    '标签一经传入即整体替换，不传则保留原标签。无法修改复习进度。',
  promptSnippet: '修改闪卡内容、标签或所属牌组',
  promptGuidelines: [
    'update_flashcard 只传需要改动的字段，未传入的字段保持原值，不要回传整张卡片内容。',
    '修改标签时传入完整的标签列表，它会整体替换原有标签，而不是追加。',
    '可以有多个标签，不同标签用空格分割。如“学习 AI 课后作业”',
  ],
  parameters: Type.Object({
    id: Type.String({ minLength: 1, description: '要修改的卡片 id' }),
    front: Type.Optional(
      Type.String({ minLength: 1, description: '新的正面内容，不传则保持不变' })
    ),
    back: Type.Optional(Type.String({ minLength: 1, description: '新的反面内容，不传则保持不变' })),
    tags: Type.Optional(
      Type.Array(Type.String(), { description: '新的标签列表，整体替换原有标签，不传则保持不变' })
    ),
    groupId: Type.Optional(
      Type.String({ minLength: 1, description: '要移动到的目标牌组 id，不传则保持原牌组不变' })
    ),
  }),
  async execute(_toolCallId, params) {
    if (
      params.front === undefined &&
      params.back === undefined &&
      params.tags === undefined &&
      params.groupId === undefined
    ) {
      throw new Error('未指定任何要修改的字段，至少传入 front、back、tags、groupId 之一');
    }

    // saveCard 需要完整内容，因此先读出当前值再与改动合并
    const current = unwrap(flashcardService.getCard({ id: params.id }), '卡片不存在：' + params.id);
    const fields: CardFields = {
      front: params.front ?? current.fields.front,
      back: params.back ?? current.fields.back,
    };

    const card = unwrap(
      flashcardService.saveCard({
        id: params.id,
        // 未传 groupId 表示保持原牌组；传了则由 saveCard 校验目标牌组是否存在
        groupId: params.groupId ?? current.groupId,
        fields,
        tags: params.tags ?? current.tags,
      }),
      '保存闪卡失败'
    );

    const details: FlashcardChangeDetail = {
      action: 'update',
      card: toChangeSnapshot(card),
      ...diffCard(current, card),
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(toCardSummary(card)) }],
      details,
    };
  },
});

/** 删除闪卡：硬删除，删除后不可恢复。 */
const deleteFlashcardTool = defineSessionTool({
  name: 'delete_flashcard',
  description: '永久删除一张闪卡，删除后无法恢复。仅应在用户明确要求删除卡片时调用。危险操作！',
  promptSnippet: '删除一张闪卡',
  parameters: Type.Object({
    id: Type.String({ minLength: 1, description: '要删除的卡片 id' }),
  }),
  async execute(_toolCallId, params) {
    // 先取一次内容：既确认卡片存在，也便于回执中说明删掉的是哪一张
    const card = unwrap(flashcardService.getCard({ id: params.id }), '卡片不存在：' + params.id);
    const result = flashcardService.deleteCard({ id: params.id });
    if (!result.success) {
      throw new Error(result.error ?? '删除闪卡失败');
    }

    // 删除后卡片已不存在，details 里保存删除前的快照供界面展示
    const details: FlashcardChangeDetail = { action: 'delete', card: toChangeSnapshot(card) };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            deleted: true,
            id: card.id,
            front: summarize(card.fields.front),
          }),
        },
      ],
      details,
    };
  },
});

/** 卡片状态字面量：数值与 ts-fsrs 的 State 枚举一致。 */
const CARD_STATE_VALUES = [0, 1, 2, 3] as const;

/** 列表默认返回条数。 */
const DEFAULT_LIST_LENGTH = 20;

/** 列表单次返回条数上限，避免把整库卡片灌进上下文。 */
const MAX_LIST_LENGTH = 100;

/** 可排序字段：均为 cards 表上的普通列。 */
const SORT_FIELD_VALUES = ['createdAt', 'updatedAt', 'due', 'difficulty', 'reps'] as const;

/** 查看闪卡列表：按条件过滤、排序并分页，只返回摘要。 */
const listFlashcardsTool = defineSessionTool({
  name: 'list_flashcards',
  description:
    '按条件列出闪卡，返回卡片 id、所属牌组、正面摘要、标签、状态与到期时间，用于定位卡片 id。' +
    `支持按牌组、标签、状态、到期时间过滤，支持多级排序，以及 offset/length 分页；` +
    `length 默认 ${DEFAULT_LIST_LENGTH}，最大 ${MAX_LIST_LENGTH}。` +
    '需要完整正反面内容时，再用 get_flashcard 按 id 查询。',
  promptSnippet: '按条件查询闪卡列表',
  promptGuidelines: [
    '要查看或搜索卡片时用 list_flashcards；它只返回摘要，需要正反面全文时用 get_flashcard。',
    '返回结果中 total 是满足条件的总数，若 total 大于 offset + 返回条数，说明还有下一批，可用 offset 继续翻页。',
    '修改或删除卡片前，先用 list_flashcards 拿到确切的卡片 id，不要凭空编造 id。',
  ],
  parameters: Type.Object({
    filter: Type.Optional(
      Type.Object({
        groupId: Type.Optional(
          Type.String({ minLength: 1, description: '牌组 id，不传则查全部牌组' })
        ),
        tags: Type.Optional(Type.Array(Type.String(), { description: '标签，需同时命中所有标签' })),
        state: Type.Optional(
          Type.Union(
            CARD_STATE_VALUES.map(value => Type.Literal(value)),
            { description: '卡片状态：0 新卡，1 学习中，2 复习中，3 重学' }
          )
        ),
        dueBefore: Type.Optional(
          Type.Number({ description: 'Unix 毫秒时间戳，只返回该时刻之前到期的卡片' })
        ),
      })
    ),
    sort: Type.Optional(
      Type.Array(
        Type.Object({
          field: Type.Union(
            SORT_FIELD_VALUES.map(value => Type.Literal(value)),
            { description: '排序字段' }
          ),
          order: Type.Union([Type.Literal('asc'), Type.Literal('desc')], {
            description: '排序方向',
          }),
        }),
        { description: '多级排序规则，按数组顺序依次生效，默认按 updatedAt 降序（最近修改在前）' }
      )
    ),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: '跳过的卡片数量，默认 0' })),
    length: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_LIST_LENGTH,
        description: `返回条数，默认 ${DEFAULT_LIST_LENGTH}，最大 ${MAX_LIST_LENGTH}`,
      })
    ),
  }),
  async execute(_toolCallId, params) {
    const offset = params.offset ?? 0;
    const length = params.length ?? DEFAULT_LIST_LENGTH;
    const { cards, total } = flashcardRepo.queryCards({
      groupId: params.filter?.groupId,
      tags: params.filter?.tags,
      state: params.filter?.state,
      dueBefore: params.filter?.dueBefore,
      sort: params.sort,
      offset,
      length,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            total,
            offset,
            length,
            // 让模型不必自己算 total - offset - length
            hasMore: offset + cards.length < total,
            cards: cards.map(row => toCardSummary(toCardRecord(row))),
          }),
        },
      ],
      details: undefined,
    };
  },
});

/** 查看闪卡详情：唯一返回正反面全文的工具。 */
const getFlashcardTool = defineSessionTool({
  name: 'get_flashcard',
  description:
    '根据卡片 id 获取一张闪卡的完整内容，包含正面和反面的 Markdown 全文、标签、所属牌组和复习状态。' +
    '需要阅读或核对卡片正文时使用；只想浏览卡片概要时用列表类工具即可。',
  promptSnippet: '查看某张闪卡的完整内容',
  promptGuidelines: [
    '要读取或核对卡片正文时用 get_flashcard；它返回正反面全文，是唯一能看到完整内容的工具。',
    '修改卡片前先调用 get_flashcard 读取当前内容，避免覆盖掉用户原有的表述。',
  ],
  parameters: Type.Object({
    id: Type.String({ minLength: 1, description: '卡片 id' }),
  }),
  async execute(_toolCallId, params) {
    const card = unwrap(flashcardService.getCard({ id: params.id }), '卡片不存在：' + params.id);

    // 详情工具给出全文，但仍不暴露 FSRS 内部参数，只留模型用得上的复习概况
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            id: card.id,
            groupId: card.groupId,
            type: card.type,
            front: card.fields.front,
            back: card.fields.back,
            tags: card.tags,
            state: card.state,
            due: formatTimestamp(card.due),
            reps: card.reps,
            lapses: card.lapses,
            lastReview: formatTimestamp(card.lastReview),
            createdAt: formatTimestamp(card.createdAt),
            updatedAt: formatTimestamp(card.updatedAt),
          }),
        },
      ],
      details: undefined,
    };
  },
});

/** 查看牌组列表：返回每个牌组的 id 与名称，供后续增删改卡片时取用 groupId。 */
const listCardGroupsTool = defineSessionTool({
  name: 'list_card_groups',
  description:
    '列出全部闪卡牌组，返回每个牌组的 id、名称和卡片数量统计。牌组数量少，一次性全部返回，不需要分页。',
  promptSnippet: '查看全部闪卡牌组（id 与名称）',
  promptGuidelines: ['需要 groupId 时先调用 list_card_groups 获取，不要凭空编造牌组 id。'],
  parameters: Type.Object({}),
  async execute() {
    const result = flashcardService.listGroups();
    if (!result.success || !result.groups) {
      throw new Error(result.error ?? '查询牌组列表失败');
    }

    // 只给出定位与概况信息，卡片内容由卡片相关工具提供
    const groups = result.groups.map(group => ({
      id: group.id,
      name: group.name,
      total: group.total,
      unlearned: group.unlearned,
      learning: group.learning,
      due: group.due,
    }));

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ total: groups.length, groups }) }],
      details: undefined,
    };
  },
});

/** 闪卡智能体可用的工具。 */
export const flashcardTools = [
  listCardGroupsTool,
  getFlashcardTool,
  listFlashcardsTool,
  createFlashcardTool,
  updateFlashcardTool,
  deleteFlashcardTool,
];
