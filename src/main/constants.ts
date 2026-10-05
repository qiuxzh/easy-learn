import { app } from 'electron';
import path from 'path';

/** 数据根目录：会话日志、书籍与图片都落在它下面 */
const dataDir = path.resolve(app.getPath('userData'), 'data');

export const Constants = {
  dataDir,
  /** 聊天输入图片的存放目录；落盘与读取都基于它拼相对路径 */
  imageDir: path.join(dataDir, 'images'),
};
