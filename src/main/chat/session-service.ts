import { randomUUID } from 'node:crypto';
import type {
  AgentSessionEvent,
  ChatEventPayload,
  DeleteSessionRequest,
  ForkSessionRequest,
  ForkSessionResult,
  OpenSessionRequest,
  OpenSessionResult,
  RenameSessionRequest,
  SessionSummary,
  StreamAbortRequest,
  StreamSendRequest,
  StreamSendResponse,
  ThinkingLevel,
} from '@shared/types/chat';
import { DomainError } from '@main/domain-error';
import type { UiEventPublisher } from '@main/contracts/ui-event-publisher';
import type { ModelConfig } from '@main/contracts/model-config';
import type { AttachmentService } from '@main/service/attachment-service';
import { AgentSession } from '@main/agent/common-agent/agent-session';
import type { AgentDefinition } from '@main/agent/common-agent/agent-definition';
import { createAgentSession } from '@main/agent/common-agent/create-agent-session';
import type { SessionLog } from '@main/agent/common-agent/session-manager';
import { ModelRuntime } from '@main/agent/model/model-runtime';
import { buildChatSystemPrompt } from './system-prompts';
import type { SessionEntity } from '@main/contracts/session';
import type { SessionRepo } from '@main/contracts/session-repo';

/** 会话标题最多保留的字数，超出部分截断。 */
const TITLE_MAX_LENGTH = 30;

/** 由首条消息压缩出会话标题。 */
function titleFromText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
}

/** 创建 SessionService 所需的依赖。 */
export interface SessionServiceDeps {
  /** 会话行仓储，用于列表、标题与存在性检查。 */
  sessionRepo: SessionRepo;
  /** 会话日志：分支读取、追加与回收。仓储已在装配时绑定，调用只传 sessionId。 */
  log: SessionLog;
  /** 附件服务：删除分支回收的附件、按 id 读图片字节。 */
  attachmentService: AttachmentService;
  /** 模型配置来源。 */
  modelConfig: ModelConfig;
  /** 事件出口。 */
  events: UiEventPublisher;
  /** 阅读智能体定义（系统提示 + 工具集），由 chat 模块组装。 */
  definition: AgentDefinition;
  /** 取当前时刻的 Unix 毫秒时间戳。默认 Date.now。 */
  now?: () => number;
}

/**
 * 会话服务：前端与 agent 内核之间的唯一入口。
 * 负责会话的增删改查、运行时池管理，以及把内核事件转发给渲染层。
 *
 */
export class SessionService {
  /** 活跃会话运行时池，一个 sessionId 对应一个 AgentSession。 */
  private readonly sessions = new Map<string, AgentSession>();

  private readonly sessionRepo: SessionRepo;
  private readonly log: SessionLog;
  private readonly attachmentService: AttachmentService;
  private readonly modelConfig: ModelConfig;
  private readonly events: UiEventPublisher;
  private readonly definition: AgentDefinition;
  private readonly now: () => number;

  /** 模型配置运行时，全进程共用一份；配置变更后调用 reload 即可生效。 */
  private readonly modelRuntime: ModelRuntime;
  /** 退订模型配置变化。 */
  private readonly unsubscribe: () => void;

  constructor(deps: SessionServiceDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.log = deps.log;
    this.attachmentService = deps.attachmentService;
    this.modelConfig = deps.modelConfig;
    this.events = deps.events;
    this.definition = deps.definition;
    this.now = deps.now ?? (() => Date.now());

    this.modelRuntime = ModelRuntime.create(() => this.modelConfig.getModels());
    this.unsubscribe = this.modelConfig.subscribeModels(() => this.modelRuntime.reload());
  }

  /** 停止监听配置并释放运行时池。应用退出时调用一次。 */
  async dispose(): Promise<void> {
    this.unsubscribe();
    for (const session of this.sessions.values()) {
      await session.dispose();
    }
    this.sessions.clear();
  }

  /**
   * 会话摘要列表，按 updatedAt 倒序。
   * 只含元数据，运行态取自运行时池，不加载消息内容。临时会话不进列表。
   */
  listSessionSummary(): SessionSummary[] {
    return this.sessionRepo.listPersistent().map(row => this.toSummary(row));
  }

  /**
   * 打开会话：返回摘要、完整日志与运行态快照。
   * 只读库、不建立运行时——浏览历史无需为模型准备上下文，也避免运行时池随浏览无限增长。
   * 会话正在运行时，快照额外带上尚未落库的那条助手消息，前端据此无缝续看。
   *
   * @throws DomainError 会话不存在
   */
  openSession(request: OpenSessionRequest): OpenSessionResult {
    const row = this.sessionRepo.findById(request.sessionId);
    if (!row) throw new DomainError('会话不存在');

    const runtime = this.sessions.get(request.sessionId);
    return {
      summary: this.toSummary(row),
      entries: this.log.load(request.sessionId).entries,
      run: {
        isRunning: runtime?.isStreaming ?? false,
        streamingMessage: runtime?.agent.state.streamingMessage,
      },
    };
  }

  /**
   * 重命名会话。
   *
   * @throws DomainError 会话不存在
   */
  renameSession(request: RenameSessionRequest): void {
    if (!this.sessionRepo.findById(request.sessionId)) throw new DomainError('会话不存在');
    this.sessionRepo.updateTitle({ id: request.sessionId, title: request.title });
  }

  /**
   * 删除会话。
   * 池中的会话先 dispose（中断运行并等待本轮落库）再出池，最后删会话行并回收只被它引用的 entry。
   */
  async deleteSession(request: DeleteSessionRequest): Promise<void> {
    const runtime = this.sessions.get(request.sessionId);
    if (runtime) {
      await runtime.dispose();
      this.sessions.delete(request.sessionId);
    }
    const { attachmentIds } = this.log.drop(request.sessionId);
    if (attachmentIds.length > 0) {
      await this.attachmentService.deleteAttachments(attachmentIds);
    }
  }

  /**
   * 从某条消息分支出新会话。
   * 会话本身只是「指向某个 entry 的引用」，所以分支是零拷贝：新会话的 tip 指向那条消息，历史由父指针天然共享。
   * 调用方给的切点只做一次完整性校验——它必须落在源会话当前分支上，否则会造出一条谁也走不到的前缀。
   *
   * @throws DomainError 父会话不存在，或切点不在源会话当前分支上
   */
  forkSession(request: ForkSessionRequest): ForkSessionResult {
    const source = this.sessionRepo.findById(request.sessionId);
    if (!source) throw new DomainError('父会话不存在');

    const { entries } = this.log.load(request.sessionId);
    if (!entries.some(entry => entry.id === request.entryId)) {
      throw new DomainError('找不到这条消息，请刷新会话后重试');
    }

    const sessionId = randomUUID();
    // 标题优先用调用方给的；留空（或只有空白）时按源会话标题自动命名，源会话没标题时用占位
    const title = request.title?.trim() || (source.title ? `${source.title} (分支)` : '分支');
    this.sessionRepo.create({
      id: sessionId,
      title,
      tipEntryId: request.entryId,
      now: this.now(),
    });

    const row = this.sessionRepo.findById(sessionId);
    if (!row) throw new DomainError('分支会话创建失败');
    return { summary: this.toSummary(row) };
  }

  /**
   * 发送用户消息：补建会话行、取得（或建立）运行时、同步本次运行的设置后发起运行。
   * 立即返回，不等待运行结束；运行期的失败由内核转成事件发出。
   *
   * @throws DomainError 会话正在运行中
   */
  async streamSend(request: StreamSendRequest): Promise<StreamSendResponse> {
    const thinkingLevel: ThinkingLevel = request.thinkingLevel ?? 'medium';
    // 首次组装会往会话日志写模型记录，会话行必须先存在
    this.ensureSessionRow(
      request.sessionId,
      request.text,
      request.images?.length ?? 0,
      request.ephemeral
    );

    // 首次组装就带上本次的思考级别，运行时建立后不必再补一次设置
    const session = this.getOrCreateRuntime(request.sessionId, thinkingLevel);
    if (session.isStreaming) {
      throw new DomainError('会话正在运行中，请等待本轮结束后再发送');
    }
    session.setThinkingLevel(thinkingLevel);
    // 系统提示按本次请求现算：换书后下一轮即刻生效，无书时段落为空、回落基础提示
    session.setSystemPrompt(
      await buildChatSystemPrompt(this.definition.tools ?? [], request.bookId)
    );

    // prompt() 直到运行结束才 resolve，因此不 await：请求需要立即返回。
    // 启动失败时补一个 agent_end，让前端从等待态里退出。
    session.prompt(request.text, { images: request.images }).catch((error: unknown) => {
      console.error('[SessionService] 运行启动失败:', error);
      this.emitEvent(request.sessionId, { type: 'agent_end', messages: [] });
    });

    return { sessionId: request.sessionId };
  }

  /**
   * 中断会话正在进行的运行。
   *
   * @returns 会话不在池中（本就没有运行）时为 false
   */
  async streamAbort(request: StreamAbortRequest): Promise<boolean> {
    const session = this.sessions.get(request.sessionId);
    if (!session) return false;
    await session.abort();
    return true;
  }

  /** 把库中的会话行与运行时状态合成列表项。 */
  private toSummary(row: SessionEntity): SessionSummary {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isRunning: this.sessions.get(row.id)?.isStreaming ?? false,
    };
  }

  /**
   * 把会话事件推送给渲染层。
   * 所有会话的事件都会推送，后端不感知前端当前打开了哪个会话。
   */
  private emitEvent(sessionId: string, event: AgentSessionEvent): void {
    const payload: ChatEventPayload = { sessionId, event };
    this.events.publish({ type: 'chat-event', payload });
  }

  /**
   * 首次发送消息时补建会话行，标题由首条消息截取；首条消息只有图片时用占位标题。
   * 临时会话在此打上标记。
   */
  private ensureSessionRow(
    sessionId: string,
    text: string,
    imageCount: number,
    ephemeral = false
  ): void {
    if (this.sessionRepo.findById(sessionId)) {
      return;
    }
    const title = titleFromText(text) || (imageCount > 0 ? '[图片]' : '');
    this.sessionRepo.create({ id: sessionId, title, ephemeral, now: this.now() });
  }

  /** 取得会话运行时；首次访问时按要求的思考级别组装，并订阅事件转发给渲染层。 */
  private getOrCreateRuntime(sessionId: string, thinkingLevel: ThinkingLevel): AgentSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createAgentSession({
        definition: this.definition,
        modelRuntime: this.modelRuntime,
        thinkingLevel,
        sessionManager: this.log.open(sessionId),
        readAttachment: id => this.attachmentService.readImageBase64(id),
      });
      session.subscribe(event => this.emitEvent(sessionId, event));
      this.sessions.set(sessionId, session);
    }
    return session;
  }
}
