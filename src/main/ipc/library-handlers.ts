import { IpcChannel } from '@shared/ipc-channels';
import type {
  CreateFolderInput,
  DeleteFileInput,
  DeleteFolderRecursiveInput,
  ImportFilesInput,
  ImportFilesResult,
  ListChildrenInput,
  ListStarredResourcesInput,
  GetResourcePathInput,
  RenameResourceInput,
  ReparentResourceInput,
  SetStarredInput,
} from '@shared/types/library';
import type { OcrCancelInput, OcrGetStateInput, OcrStartInput } from '@shared/types/ocr';
import type { LibraryService } from '@main/service/library/library-service';
import type { LibraryOcrService } from '@main/service/library/library-ocr-service';
import { pickLibraryFiles } from './dialogs';
import { registerDirectHandler } from './register-handler';

/**
 * 注册资料库与资料 OCR 相关通道。
 *
 * 业务失败以领域错误抛给渲染层；导入是唯一的批量入口，单条失败通过结果里的 `rejected` 返回。
 *
 * @param library 装配根持有的资料库服务
 * @param ocr 装配根持有的资料 OCR 服务
 */
export function registerLibraryHandlers(library: LibraryService, ocr: LibraryOcrService): void {
  // 列出某目录的直接子项
  registerDirectHandler(IpcChannel.Library_ListChildren, (request: ListChildrenInput) =>
    library.listChildren(request.parentId, request)
  );

  // 新建文件夹
  registerDirectHandler(IpcChannel.Library_CreateFolder, (request: CreateFolderInput) =>
    library.createFolder(request.parentId, request.name)
  );

  // 弹框选文件并导入到目标目录
  registerDirectHandler(
    IpcChannel.Library_ImportFiles,
    async (request: ImportFilesInput): Promise<ImportFilesResult> => {
      const filePaths = await pickLibraryFiles();
      if (!filePaths) return { canceled: true, imported: [], rejected: [] };
      return library.importFiles(request.parentId, filePaths);
    }
  );

  // 重命名单个文件或文件夹
  registerDirectHandler(IpcChannel.Library_RenameResource, (request: RenameResourceInput) =>
    library.renameResource(request.id, request.name)
  );

  // 把文件或文件夹移到新父目录
  registerDirectHandler(IpcChannel.Library_ReparentResource, (request: ReparentResourceInput) =>
    library.reparentResource(request.id, request.newParentId)
  );

  // 删除单个文件，含库内源文件
  registerDirectHandler(IpcChannel.Library_DeleteFile, (request: DeleteFileInput) => {
    library.deleteFile(request.id);
  });

  // 递归删除文件夹及其全部子项
  registerDirectHandler(
    IpcChannel.Library_DeleteFolderRecursive,
    (request: DeleteFolderRecursiveInput) => {
      library.deleteFolderRecursive(request.id);
    }
  );

  // 列出收藏的条目
  registerDirectHandler(
    IpcChannel.Library_ListStarredResources,
    (request: ListStarredResourcesInput) => library.listStarredResources(request)
  );

  // 资料库占用的磁盘空间
  registerDirectHandler(IpcChannel.Library_GetStorageUsage, () => library.getStorageUsage());

  // 设置收藏状态
  registerDirectHandler(IpcChannel.Library_SetStarred, (request: SetStarredInput) =>
    library.setStarred(request.id, request.starred)
  );

  // 取目录到根的路径，用于面包屑
  registerDirectHandler(IpcChannel.Library_GetResourcePath, (request: GetResourcePathInput) =>
    library.getResourcePath(request.id)
  );

  // 读取一个资料的识别状态
  registerDirectHandler(IpcChannel.Library_OcrGetState, (request: OcrGetStateInput) =>
    ocr.getState(request.resourceId)
  );

  // 启动识别；restart 为 true 时清掉旧页块与分片
  registerDirectHandler(IpcChannel.Library_OcrStart, (request: OcrStartInput) =>
    ocr.start(request.resourceId, { restart: request.restart })
  );

  // 取消该资料正在进行的识别任务
  registerDirectHandler(IpcChannel.Library_OcrCancel, (request: OcrCancelInput) =>
    ocr.cancel(request.resourceId)
  );
}
