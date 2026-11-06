/**
 * 业务规则拒绝执行时抛出的错误。
 *
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
