// 井号开头表示是后端向前端发送的消息
export enum IpcChannel {
  // 会话管理（模块 src/main/chat）
  /** 会话摘要列表，按最近活跃倒序，含运行态 */
  Chat_ListSessionSummary = 'chat:listSessionSummary',
  Chat_RenameSession = 'chat:renameSession',
  Chat_DeleteSession = 'chat:deleteSession',
  /** 打开会话：返回摘要、完整日志与运行态快照 */
  Chat_OpenSession = 'chat:openSession',

  // AI 流式响应
  Chat_StreamSend = 'chat:streamSend',
  Chat_StreamAbort = 'chat:streamAbort',
  /** 后端向前端推送的会话事件，载荷为 { sessionId, event } */
  Chat_Event = '#chat:event',

  // Window Control
  Window_Minimize = 'window:minimize',
  Window_Maximize = 'window:maximize',
  Window_Close = 'window:close',
  Window_IsMaximized = 'window:isMaximized',
  Window_MaximizedStateChanged = 'window:maximizedStateChanged',

  // File 操作
  File_OpenDialog = 'file:openDialog',

  // 图片（聊天输入）
  /** 图片入库：落盘粘贴的图片字节，或由 main 端弹框选择图片，返回可引用的图片内容 */
  Image_Store = 'image:store',

  // 书籍（书库）
  /** main 端打开 dialog 选文件 + 解析 + 写库，返回 BookDoc */
  Book_PickAndImport = 'book:pickAndImport',
  Book_GetAllBooks = 'book:getAllBooks',
  Book_DeleteBook = 'book:deleteBook',

  /** 阅读器打开书时，根据 id 拿 app:// 协议 URL */
  Book_GetBook = 'book:getBook',

  // 闪卡
  Card_ListGroups = 'card:listGroups',
  Card_CreateGroup = 'card:createGroup',
  Card_RenameGroup = 'card:renameGroup',
  Card_DeleteGroup = 'card:deleteGroup',
  Card_ListCards = 'card:listCards',
  Card_GetCard = 'card:getCard',
  Card_SaveCard = 'card:saveCard',
  Card_DeleteCard = 'card:deleteCard',
  Card_GetReviewQueue = 'card:getReviewQueue',
  Card_ReviewCard = 'card:reviewCard',

  // 阅读状态
  Reading_PushState = 'reading:pushState',

  // 配置
  Config_Get = 'config:get',
  Config_Set = 'config:set',
  Config_Update = 'config:update',
  Config_Remove = 'config:remove',
  /** 后端向前端推送的配置快照 */
  Config_Changed = '#config:changed',

  // 向量模型
  /** 调用 embeddings 接口发一条测试文本，返回向量维度 */
  Embedding_TestEndpoint = 'embedding:testEndpoint',
}
