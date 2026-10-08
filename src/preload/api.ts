import type {
  ChatEventPayload,
  DeleteSessionRequest,
  ImageContent,
  ImageStoreRequest,
  OpenSessionRequest,
  OpenSessionResult,
  RenameSessionRequest,
  SessionSummary,
  StreamAbortRequest,
  StreamAbortResponse,
  StreamSendRequest,
  StreamSendResponse,
} from '@shared/types/chat';
import type { FileOpenRequest, FileOpenResult } from '@shared/types/file';
import type {
  TestEmbeddingEndpointRequest,
  TestEmbeddingEndpointResult,
} from '@shared/types/embedding';
import type {
  BookDeleteRequest,
  BookDeleteResult,
  BookGetRequest,
  BookGetResult,
  BookImportResult,
  BookListResult,
  BookPickCoverResult,
  BookUpdateRequest,
  BookUpdateResult,
} from '@shared/types/books';
import type { ReadingStatePayload } from '@shared/types/reader';
import type {
  CardGroupListResult,
  CardGroupResult,
  CardListResult,
  CardResult,
  CreateCardGroupRequest,
  DeleteCardGroupRequest,
  DeleteCardRequest,
  GetCardRequest,
  ListCardsRequest,
  RenameCardGroupRequest,
  ReviewCardRequest,
  ReviewQueueRequest,
  SaveCardRequest,
} from '@shared/types/flashcards';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  ConfigRemoveRequest,
  ConfigSetRequest,
  ConfigSnapshot,
  ConfigUpdateRequest,
} from '@shared/config';

export const api = {
  // 会话管理
  listSessions: () =>
    ipcRenderer.invoke(IpcChannel.Chat_ListSessionSummary) as Promise<SessionSummary[]>,
  openSession: (params: OpenSessionRequest) =>
    ipcRenderer.invoke(IpcChannel.Chat_OpenSession, params) as Promise<OpenSessionResult>,
  renameSession: (params: RenameSessionRequest) =>
    ipcRenderer.invoke(IpcChannel.Chat_RenameSession, params),
  deleteSession: (params: DeleteSessionRequest) =>
    ipcRenderer.invoke(IpcChannel.Chat_DeleteSession, params),

  // 流式响应 - render 发起请求
  sendMessage: (params: StreamSendRequest) =>
    ipcRenderer.invoke(IpcChannel.Chat_StreamSend, params) as Promise<StreamSendResponse>,
  streamAbort: (params: StreamAbortRequest) =>
    ipcRenderer.invoke(IpcChannel.Chat_StreamAbort, params) as Promise<StreamAbortResponse>,

  // 流式响应 - main 主动推送，render 监听（监听逻辑在 chatStreamController 中初始化）
  onChatEvent: (callback: (data: ChatEventPayload) => void) => {
    ipcRenderer.on(IpcChannel.Chat_Event, (_, data) => callback(data));
  },

  // 配置
  config: {
    get: () => ipcRenderer.invoke(IpcChannel.Config_Get) as Promise<ConfigSnapshot>,
    set: (request: ConfigSetRequest) =>
      ipcRenderer.invoke(IpcChannel.Config_Set, request) as Promise<ConfigSnapshot>,
    update: (request: ConfigUpdateRequest) =>
      ipcRenderer.invoke(IpcChannel.Config_Update, request) as Promise<ConfigSnapshot>,
    remove: (request: ConfigRemoveRequest) =>
      ipcRenderer.invoke(IpcChannel.Config_Remove, request) as Promise<ConfigSnapshot>,
    onChanged: (callback: (snapshot: ConfigSnapshot) => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: ConfigSnapshot) => callback(snapshot);
      ipcRenderer.on(IpcChannel.Config_Changed, listener);
      return () => ipcRenderer.removeListener(IpcChannel.Config_Changed, listener);
    },
  },

  // 向量模型
  embedding: {
    testEndpoint: (request: TestEmbeddingEndpointRequest) =>
      ipcRenderer.invoke(
        IpcChannel.Embedding_TestEndpoint,
        request
      ) as Promise<TestEmbeddingEndpointResult>,
  },
  // 窗口相关的内容
  minimize: () => ipcRenderer.send(IpcChannel.Window_Minimize),
  maximize: () => ipcRenderer.send(IpcChannel.Window_Maximize),
  close: () => ipcRenderer.send(IpcChannel.Window_Close),
  isMaximized: () => ipcRenderer.invoke(IpcChannel.Window_IsMaximized) as Promise<boolean>,
  onMaximizedStateChanged: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on(IpcChannel.Window_MaximizedStateChanged, (_, isMaximized) =>
      callback(isMaximized)
    );
  },

  // 文件操作
  openFileDialog: (req?: FileOpenRequest) =>
    ipcRenderer.invoke(IpcChannel.File_OpenDialog, req) as Promise<FileOpenResult>,

  // 图片（聊天输入）
  storeImages: (req: ImageStoreRequest) =>
    ipcRenderer.invoke(IpcChannel.Image_Store, req) as Promise<ImageContent[]>,

  // 书籍（书库）
  /** 让 main 端弹文件框 + 解析 + 写库，返回 BookDoc */
  pickAndImportBook: () =>
    ipcRenderer.invoke(IpcChannel.Book_PickAndImport) as Promise<BookImportResult>,
  getAllBooks: () => ipcRenderer.invoke(IpcChannel.Book_GetAllBooks) as Promise<BookListResult>,
  deleteBook: (id: string) =>
    ipcRenderer.invoke(IpcChannel.Book_DeleteBook, {
      id,
    } as BookDeleteRequest) as Promise<BookDeleteResult>,
  getBook: (id: string) =>
    ipcRenderer.invoke(IpcChannel.Book_GetBook, { id } as BookGetRequest) as Promise<BookGetResult>,
  /** 弹框选取封面图片，返回字节供渲染层预览（此时还未落盘） */
  pickBookCover: () =>
    ipcRenderer.invoke(IpcChannel.Book_PickCover) as Promise<BookPickCoverResult>,
  /** 更新书名 / 作者 / 封面，返回更新后的 BookDoc */
  updateBook: (request: BookUpdateRequest) =>
    ipcRenderer.invoke(IpcChannel.Book_UpdateBook, request) as Promise<BookUpdateResult>,
  pushReadingState: (payload: ReadingStatePayload) =>
    ipcRenderer.invoke(IpcChannel.Reading_PushState, payload) as Promise<void>,
  // 闪卡
  listCardGroups: () =>
    ipcRenderer.invoke(IpcChannel.Card_ListGroups) as Promise<CardGroupListResult>,
  createCardGroup: (request: CreateCardGroupRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_CreateGroup, request) as Promise<CardGroupResult>,
  renameCardGroup: (request: RenameCardGroupRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_RenameGroup, request) as Promise<CardGroupResult>,
  deleteCardGroup: (request: DeleteCardGroupRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_DeleteGroup, request) as Promise<CardGroupResult>,
  listCards: (request: ListCardsRequest = {}) =>
    ipcRenderer.invoke(IpcChannel.Card_ListCards, request) as Promise<CardListResult>,
  getCard: (request: GetCardRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_GetCard, request) as Promise<CardResult>,
  saveCard: (request: SaveCardRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_SaveCard, request) as Promise<CardResult>,
  deleteCard: (request: DeleteCardRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_DeleteCard, request) as Promise<CardResult>,
  getReviewQueue: (request: ReviewQueueRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_GetReviewQueue, request) as Promise<CardListResult>,
  reviewCard: (request: ReviewCardRequest) =>
    ipcRenderer.invoke(IpcChannel.Card_ReviewCard, request) as Promise<CardResult>,
};
