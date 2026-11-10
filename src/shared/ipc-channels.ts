// 井号开头表示是后端向前端发送的消息
export enum IpcChannel {
  // 会话管理（模块 src/main/chat）
  /** 会话摘要列表，按最近活跃倒序，含运行态 */
  Chat_ListSessionSummary = 'chat:listSessionSummary',
  Chat_RenameSession = 'chat:renameSession',
  Chat_DeleteSession = 'chat:deleteSession',
  /** 打开会话：返回摘要、完整日志与运行态快照 */
  Chat_OpenSession = 'chat:openSession',
  /** 从某条助手消息分支出一个新会话 */
  Chat_ForkSession = 'chat:forkSession',

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

  // 资料库（虚拟文件系统）
  /** 列出某目录的直接子项 */
  Library_ListChildren = 'library:listChildren',
  /** 新建文件夹 */
  Library_CreateFolder = 'library:createFolder',
  /** main 端弹框选多个文件并复制进目标目录 */
  Library_ImportFiles = 'library:importFiles',
  /** 重命名单个文件或文件夹 */
  Library_RenameResource = 'library:renameResource',
  /** 把文件或文件夹移到新父目录 */
  Library_ReparentResource = 'library:reparentResource',
  /** 删除单个文件（含库内源文件） */
  Library_DeleteFile = 'library:deleteFile',
  /** 递归删除文件夹及其全部子项（含库内源文件） */
  Library_DeleteFolderRecursive = 'library:deleteFolderRecursive',
  /** 列出收藏的条目 */
  Library_ListStarredResources = 'library:listStarredResources',
  /** 资料库占用的磁盘空间 */
  Library_GetStorageUsage = 'library:getStorageUsage',
  /** 设置收藏状态 */
  Library_SetStarred = 'library:setStarred',
  /** 取目录到根的路径，用于面包屑 */
  Library_GetResourcePath = 'library:getResourcePath' /** 读取一个资料的识别状态 */,
  Library_OcrGetState = 'library:ocrGetState',
  /** 启动识别；`restart` 为 true 时清掉旧页块与分片 */
  Library_OcrStart = 'library:ocrStart',
  /** 取消该资料正在进行的识别任务 */
  Library_OcrCancel = 'library:ocrCancel',

  // 后台任务（任务编排器）
  /** 全部任务：排队、运行、暂停与失败 */
  Task_List = 'task:list',
  /** 按 id 取单个任务 */
  Task_Get = 'task:get',
  Task_Pause = 'task:pause',
  Task_Resume = 'task:resume',
  Task_Cancel = 'task:cancel',
  Task_Retry = 'task:retry',
  /** 忽略失败任务，删除记录 */
  Task_Dismiss = 'task:dismiss',
  /** 主进程推给渲染层的任务事件 */
  Task_Event = '#task:event',

  // 附件（聊天输入）
  /** 附件入库：落盘图片字节或弹框选择，返回图片引用 */
  Attachment_Store = 'attachment:store',

  // 书籍（书库）
  /** main 端打开 dialog 选文件 + 解析 + 写库，返回 BookDto */
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

  // 书籍的文字提取（OCR）。同样只在主进程内存里跑，重启后已完成的页仍在 book_page，
  // 未完成的重新提交即可，所以不需要任务表
  Book_OcrStart = 'book:ocrStart',
  Book_OcrCancel = 'book:ocrCancel',
  /** 取一次运行态快照，供渲染层刷新后对齐 */
  Book_OcrDescribe = 'book:ocrDescribe',
  /** 后端向前端推送运行态与结束事件 */
  Book_OcrEvent = '#book:ocrEvent',

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
