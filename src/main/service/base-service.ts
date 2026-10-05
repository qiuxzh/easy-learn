export abstract class BaseService {
  /** 已实例化服务；具体服务在构造时自动注册。 */
  private static readonly services = new Set<BaseService>();

  constructor() {
    BaseService.services.add(this);
  }

  /** 统一注册所有服务的 IPC 处理器。 */
  static setupAllIpcHandlers(): void {
    for (const service of BaseService.services) {
      service.setupIpcHandlers();
    }
  }

  onInit(): void {}
  onCleanUp(): void {}
  setupIpcHandlers(): void {
    throw new Error('Method not implemented.');
  }
}
