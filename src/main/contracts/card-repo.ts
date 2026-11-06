import type {
  CardEntity,
  CardGroupEntity,
  CardPage,
  CardQuery,
  CardSchedule,
  CardWrite,
} from './card';

/**
 * 卡片的持久化接口。
 *
 * 默认实现在 `src/main/infra/repo/create-card-repo.ts`；方法签名只出现领域实体，不暴露 SQL 或 ORM
 * 类型。查询类方法在记录不存在时返回 `undefined`，写入类方法失败才抛错。
 *
 * 过滤、排序与分页都由实现在 SQL 层完成，调用方传条件、不传实现细节。
 */
export interface CardRepo {
  /** 查询全部卡片，按创建时间升序。 */
  findAllCards(): CardEntity[];
  /** 按 id 查询卡片。 */
  findCardById(id: string): CardEntity | undefined;
  /** 查询指定牌组下的卡片，按创建时间升序。 */
  findCardsByGroupId(groupId: string): CardEntity[];
  /** 按条件分页查询卡片。 */
  queryCards(input: CardQuery): CardPage;
  /** 查询全部卡片出现过的标签，去重但顺序不保证；排序由调用方决定。 */
  listTags(): string[];

  /** 新增卡片，返回落库后的记录。 */
  createCard(input: CardWrite): CardEntity;
  /** 覆盖卡片内容并保留复习状态；卡片不存在时返回 undefined。 */
  updateCardContent(input: CardWrite): CardEntity | undefined;
  /** 回写复习后的 FSRS 状态；卡片不存在时返回 undefined。 */
  updateCardSchedule(id: string, schedule: CardSchedule, now: number): CardEntity | undefined;
  /** 删除单张卡片。 */
  deleteCard(id: string): void;

  /** 查询指定牌组的复习队列：到期卡片优先、新卡随后，同组内按到期时间升序。 */
  findReviewQueue(input: { groupId: string; now: number }): CardEntity[];
  /** 查询全部牌组的复习队列，排序规则同上。 */
  findAllReviewQueue(now: number): CardEntity[];
}
/** 牌组的持久化接口。 */
export interface CardGroupRepo {
  /** 查询全部牌组，按创建时间升序。 */
  findGroups(): CardGroupEntity[];
  /** 按 id 查询牌组。 */
  findGroupById(id: string): CardGroupEntity | undefined;
  /** 新增牌组，返回落库后的行。 */
  createGroup(input: { name: string; now: number }): CardGroupEntity;
  /** 修改牌组名称；牌组不存在时返回 undefined。 */
  renameGroup(input: { id: string; name: string; now: number }): CardGroupEntity | undefined;
  /** 删除牌组，其卡片由数据库外键级联删除。 */
  deleteGroup(id: string): void;
}
