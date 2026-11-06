/**
 * 闪卡服务的行为。
 *
 * 两个仓储用假实现替换，因此这里只验证业务规则：名称与内容校验、FSRS 进度初始化与回写、
 * 复习队列的牌组校验，以及牌组统计的口径。
 */
import { describe, expect, it, vi } from 'vitest';
import type { CardGroupEntity, CardEntity, CardSchedule } from '@main/contracts/card';
import type { CardRepo } from '@main/contracts/card-repo';
import type { CardGroupRepo } from '@main/contracts/card-repo';
import { FlashcardService } from '../flashcard-service';

/** 固定时刻，让 FSRS 的计算结果可断言。 */
const NOW = 1_700_000_000_000;

function createCard(overrides: Partial<CardEntity> = {}): CardEntity {
  return {
    id: 'card-1',
    groupId: 'group-1',
    type: 'basic',
    fields: { front: '正面', back: '反面' },
    tags: [],
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    due: NOW,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    ...overrides,
  };
}

function createGroup(overrides: Partial<CardGroupEntity> = {}): CardGroupEntity {
  return { id: 'group-1', name: '默认牌组', createdAt: NOW, updatedAt: NOW, ...overrides };
}

/** 构造假卡片仓储，未指定的方法返回空结果；用例只覆盖需要的部分。 */
function createFakeCardRepo(overrides: Partial<CardRepo> = {}): CardRepo {
  return {
    findAllCards: vi.fn(() => []),
    findCardById: vi.fn(() => undefined),
    findCardsByGroupId: vi.fn(() => []),
    queryCards: vi.fn(() => ({ cards: [], total: 0 })),
    listTags: vi.fn(() => []),
    createCard: vi.fn(),
    updateCardContent: vi.fn(),
    updateCardSchedule: vi.fn(),
    deleteCard: vi.fn(),
    findReviewQueue: vi.fn(() => []),
    findAllReviewQueue: vi.fn(() => []),
    ...overrides,
  } as CardRepo;
}

/** 构造假牌组仓储，未指定的方法返回空结果。 */
function createFakeGroupRepo(overrides: Partial<CardGroupRepo> = {}): CardGroupRepo {
  return {
    findGroups: vi.fn(() => []),
    findGroupById: vi.fn(() => undefined),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    ...overrides,
  } as CardGroupRepo;
}

function createService(cardRepo: CardRepo, cardGroupRepo: CardGroupRepo): FlashcardService {
  return new FlashcardService({ cardRepo, cardGroupRepo, now: () => NOW });
}

describe('FlashcardService 牌组', () => {
  it('新增牌组时去掉首尾空白，并用注入的时刻落库', () => {
    const groupRepo = createFakeGroupRepo({
      createGroup: vi.fn(input => createGroup({ name: input.name })),
    });
    const service = createService(createFakeCardRepo(), groupRepo);

    expect(service.createGroup({ name: '  英语  ' }).name).toBe('英语');
    expect(groupRepo.createGroup).toHaveBeenCalledWith({ name: '英语', now: NOW });
  });

  it('牌组名称为空时拒绝写入', () => {
    const groupRepo = createFakeGroupRepo();
    const service = createService(createFakeCardRepo(), groupRepo);

    expect(() => service.createGroup({ name: '   ' })).toThrow('牌组名称不能为空');
    expect(groupRepo.createGroup).not.toHaveBeenCalled();
  });

  it('重命名不存在的牌组时报错', () => {
    const service = createService(createFakeCardRepo(), createFakeGroupRepo());

    expect(() => service.renameGroup({ id: 'missing', name: '新名字' })).toThrow('牌组不存在');
  });

  it('删除牌组前先确认存在', () => {
    const groupRepo = createFakeGroupRepo({ findGroupById: vi.fn(() => createGroup()) });
    const service = createService(createFakeCardRepo(), groupRepo);

    service.deleteGroup({ id: 'group-1' });
    expect(groupRepo.deleteGroup).toHaveBeenCalledWith('group-1');
  });

  it('按到期时间统计各牌组的复习进度', () => {
    const cardRepo = createFakeCardRepo({
      findAllCards: vi.fn(() => [
        createCard({ id: 'new', state: 0 }),
        createCard({ id: 'learning-due', state: 1, due: NOW - 1 }),
        createCard({ id: 'learning-future', state: 1, due: NOW + 1 }),
        createCard({ id: 'review-due', state: 2, due: NOW }),
      ]),
    });
    const groupRepo = createFakeGroupRepo({ findGroups: vi.fn(() => [createGroup()]) });
    const service = createService(cardRepo, groupRepo);

    expect(service.listGroups()).toEqual([
      expect.objectContaining({ id: 'group-1', unlearned: 1, learning: 1, due: 1, total: 4 }),
    ]);
  });

  it('双牌组的统计互不串卡', () => {
    const cardRepo = createFakeCardRepo({
      findAllCards: vi.fn(() => [
        createCard({ id: 'a-1', groupId: 'group-a', state: 0 }),
        createCard({ id: 'b-1', groupId: 'group-b', state: 2, due: NOW - 1 }),
      ]),
    });
    const groupRepo = createFakeGroupRepo({
      findGroups: vi.fn(() => [
        createGroup({ id: 'group-a', name: 'A' }),
        createGroup({ id: 'group-b', name: 'B' }),
      ]),
    });
    const service = createService(cardRepo, groupRepo);

    const [groupA, groupB] = service.listGroups();
    expect(groupA).toMatchObject({ id: 'group-a', unlearned: 1, due: 0, total: 1 });
    expect(groupB).toMatchObject({ id: 'group-b', unlearned: 0, due: 1, total: 1 });
  });
});

describe('FlashcardService 卡片', () => {
  it('新建卡片时按 FSRS 初始化复习进度并归一化标签', () => {
    const cardRepo = createFakeCardRepo({
      createCard: vi.fn(input => createCard({ ...input, id: 'card-1' })),
    });
    const groupRepo = createFakeGroupRepo({ findGroupById: vi.fn(() => createGroup()) });
    const service = createService(cardRepo, groupRepo);

    service.saveCard({
      groupId: 'group-1',
      fields: { front: '正面', back: '反面' },
      tags: [' 标签 ', '标签', ''],
    });

    expect(cardRepo.createCard).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        tags: ['标签'],
        createdAt: NOW,
        due: NOW,
        state: 0,
        reps: 0,
        lastReview: null,
      })
    );
    expect(cardRepo.updateCardContent).not.toHaveBeenCalled();
  });

  it('正反面为空时拒绝保存', () => {
    const cardRepo = createFakeCardRepo();
    const service = createService(
      cardRepo,
      createFakeGroupRepo({ findGroupById: vi.fn(() => createGroup()) })
    );

    expect(() =>
      service.saveCard({ groupId: 'group-1', fields: { front: ' ', back: '反面' }, tags: [] })
    ).toThrow('卡片正面不能为空');
    expect(cardRepo.createCard).not.toHaveBeenCalled();
  });

  it('保存到不存在的牌组时报错', () => {
    const service = createService(createFakeCardRepo(), createFakeGroupRepo());

    expect(() =>
      service.saveCard({ groupId: 'missing', fields: { front: 'a', back: 'b' }, tags: [] })
    ).toThrow('牌组不存在');
  });

  it('编辑已有卡片时保留复习进度，只更新内容', () => {
    const existing = createCard({ reps: 7, state: 2, stability: 3.5, due: NOW + 86_400_000 });
    const cardRepo = createFakeCardRepo({
      findCardById: vi.fn(() => existing),
      updateCardContent: vi.fn(() => existing),
    });
    const service = createService(
      cardRepo,
      createFakeGroupRepo({ findGroupById: vi.fn(() => createGroup()) })
    );

    service.saveCard({
      id: existing.id,
      groupId: 'group-1',
      fields: { front: '新正面', back: '新反面' },
      tags: [],
    });

    expect(cardRepo.updateCardContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        reps: 7,
        state: 2,
        due: existing.due,
        createdAt: existing.createdAt,
        updatedAt: NOW,
      })
    );
    expect(cardRepo.createCard).not.toHaveBeenCalled();
  });

  it('复习后回写 FSRS 状态，新卡进入学习中', () => {
    const cardRepo = createFakeCardRepo({
      findCardById: vi.fn(() => createCard()),
      updateCardSchedule: vi.fn((_id: string, schedule: CardSchedule) =>
        createCard({ ...schedule })
      ),
    });
    const service = createService(cardRepo, createFakeGroupRepo());

    const reviewed = service.reviewCard({ id: 'card-1', rating: 'good' });

    expect(cardRepo.updateCardSchedule).toHaveBeenCalledWith(
      'card-1',
      expect.objectContaining({ reps: 1, lastReview: NOW }),
      NOW
    );
    expect(reviewed.state).toBe(1);
    expect(reviewed.due).toBeGreaterThan(NOW);
  });

  it('删除不存在的卡片时报错', () => {
    const service = createService(createFakeCardRepo(), createFakeGroupRepo());

    expect(() => service.deleteCard({ id: 'missing' })).toThrow('卡片不存在');
  });

  it('查询复习队列时校验牌组存在', () => {
    const cardRepo = createFakeCardRepo();
    const service = createService(cardRepo, createFakeGroupRepo());

    expect(() => service.getReviewQueue({ groupId: 'missing' })).toThrow('牌组不存在');
    expect(() => service.getReviewQueue({})).not.toThrow();
    expect(cardRepo.findAllReviewQueue).toHaveBeenCalledWith(NOW);
  });

  it('列表的标签去重排序后返回', () => {
    const cardRepo = createFakeCardRepo({
      queryCards: vi.fn(() => ({ cards: [createCard({ tags: ['b', 'a'] })], total: 1 })),
      listTags: vi.fn(() => ['b', 'a', 'a']),
    });
    const service = createService(cardRepo, createFakeGroupRepo());

    const result = service.listCards({});
    expect(result.cards).toHaveLength(1);
    expect(result.tags).toEqual(['a', 'b']);
  });
});
