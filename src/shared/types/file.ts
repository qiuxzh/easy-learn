/** 文件对话框请求参数。不传 filters 时由后端决定默认值 */
export interface FileOpenRequest {
  filters?: Array<{ name: string; extensions: string[] }>;
}

/** 文件对话框响应 */
export interface FileOpenResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}
