import { ReadingService } from './reading-service';

/** 阅读状态模块对外暴露的能力。 */
export interface ReadingModule {
  /** 阅读状态服务。 */
  readingService: ReadingService;
}

/**
 * 创建阅读状态模块。
 *
 * 服务本身无状态，模块仅作为装配边界存在。
 */
export function createReadingModule(): ReadingModule {
  return { readingService: new ReadingService() };
}
