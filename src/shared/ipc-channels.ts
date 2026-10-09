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
  /** main 端弹框选取封面图片，只返回字节给渲染层预览 */
  Book_PickCover = 'book:pickCover',
  /** 更新书名 / 作者 / 封面 */
  Book_UpdateBook = 'book:updateBook',

  /** 阅读器打开书时，根据 id 拿 app:// 协议 URL */
  Book_GetBook = 'book:getBook',

  /** 重新切分正文：重解析原文件、替换分片、清空该书全部向量 */
  Book_RechunkBook = 'book:rechunkBook',

  // 书籍的向量化任务。运行态只活在主进程内存里，所以命令与查询都挂在 book 下——
  // 它们操作的是「某本书正在被向量化」这件事，不是模型配置
  Book_EmbeddingStart = 'book:embeddingStart',
  Book_EmbeddingPause = 'book:embeddingPause',
  Book_EmbeddingResume = 'book:embeddingResume',
  Book_EmbeddingCancel = 'book:embeddingCancel',
  /** 取一次运行态快照，供渲染层刷新后对齐 */
  Book_EmbeddingDescribe = 'book:embeddingDescribe',
  /** 后端向前端推送运行态：进度推进、阶段变化、队列变化都走它 */
  Book_EmbeddingRuntime = '#book:embeddingRuntime',

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

  // 向量模型配置
  /** 调用 embeddings 接口发一条测试文本，返回向量维度 */
  Embedding_TestEndpoint = 'embedding:testEndpoint',
}
