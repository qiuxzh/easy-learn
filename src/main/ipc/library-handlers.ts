import { IpcChannel } from '@shared/ipc-channels';
import type {
  CreateFolderInput,
  DeleteFileInput,
  DeleteFolderRecursiveInput,
  ImportFilesInput,
  ImportFilesResult,
  ListAllFilesInput,
  ListChildrenInput,
  ListRecentFilesInput,
  ListStarredResourcesInput,
  MarkOpenedInput,
  GetResourcePathInput,
  RenameResourceInput,
  ReparentResourceInput,
  SetStarredInput,
} from '@shared/types/library';
import type { LibraryService } from '@main/service/library/library-service';
import { pickLibraryFiles } from './dialogs';
import { registerDirectHandler } from './register-handler';

/**
 * 注册资料库相关通道。
 *
 * 业务失败以领域错误抛给渲染层；导入是唯一的批量入口，单条失败通过结果里的 `rejected` 返回。
 *
 * @param library 装配根持有的资料库服务
 */
export function registerLibraryHandlers(library: LibraryService): void {
  registerDirectHandler(IpcChannel.Library_ListChildren, (request: ListChildrenInput) =>
    library.listChildren(request.parentId, request)
  );

  registerDirectHandler(IpcChannel.Library_CreateFolder, (request: CreateFolderInput) =>
    library.createFolder(request.parentId, request.name)
  );

  registerDirectHandler(
    IpcChannel.Library_ImportFiles,
    async (request: ImportFilesInput): Promise<ImportFilesResult> => {
      const filePaths = await pickLibraryFiles();
      if (!filePaths) return { canceled: true, imported: [], rejected: [] };
      return library.importFiles(request.parentId, filePaths);
    }
  );

  registerDirectHandler(IpcChannel.Library_RenameResource, (request: RenameResourceInput) =>
    library.renameResource(request.id, request.name)
  );

  registerDirectHandler(IpcChannel.Library_ReparentResource, (request: ReparentResourceInput) =>
    library.reparentResource(request.id, request.newParentId)
  );

  registerDirectHandler(IpcChannel.Library_DeleteFile, (request: DeleteFileInput) => {
    library.deleteFile(request.id);
  });

  registerDirectHandler(
    IpcChannel.Library_DeleteFolderRecursive,
    (request: DeleteFolderRecursiveInput) => {
      library.deleteFolderRecursive(request.id);
    }
  );

  registerDirectHandler(IpcChannel.Library_ListAllFiles, (request: ListAllFilesInput) =>
    library.listAllFiles(request)
  );

  registerDirectHandler(IpcChannel.Library_ListRecentFiles, (request: ListRecentFilesInput) =>
    library.listRecentFiles(request)
  );

  registerDirectHandler(
    IpcChannel.Library_ListStarredResources,
    (request: ListStarredResourcesInput) => library.listStarredResources(request)
  );

  registerDirectHandler(IpcChannel.Library_GetStorageUsage, () => library.getStorageUsage());

  registerDirectHandler(IpcChannel.Library_SetStarred, (request: SetStarredInput) =>
    library.setStarred(request.id, request.starred)
  );

  registerDirectHandler(IpcChannel.Library_MarkOpened, (request: MarkOpenedInput) => {
    library.markOpened(request.id);
  });

  registerDirectHandler(IpcChannel.Library_GetResourcePath, (request: GetResourcePathInput) =>
    library.getResourcePath(request.id)
  );
}
