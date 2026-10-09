/**
 * 模型身份：判断「两套模型参数是不是同一个向量空间」。
 *
 * 公开面只有两件事——算身份摘要（主进程用来做注册表的唯一键与向量表名后缀），
 * 以及判断一本书的向量是不是当前模型生成的（渲染层用来判断「索引失效」）。
 * 归一化、拼装、哈希都是实现细节，不外露。
 *
 * **两端共用这一份实现**：主进程与渲染层对「同一个模型」的判断必须逐字节一致，
 * 否则界面会显示「已索引」而实际查不到对应的向量，而且不会报错。
 */

/** 一套模型参数的身份。 */
export interface EmbeddingIdentity {
  /** embeddings 请求地址。原始值即可，归一化在内部做 */
  endpoint: string;
  /** 请求时传给接口的 model 名 */
  modelId: string;
}

/**
 * 距离度量，传给 sqlite-vector 的 `vector_init`。
 *
 * 它是身份的一部分（见下面的摘要拼装），**改动必须同时递增 `VECTOR_SPACE_VERSION`**，
 * 否则换了度量却沿用同一批指纹，新旧向量会被当成同一种空间混用。
 */
export const VECTOR_DISTANCE = 'COSINE';

/**
 * 向量空间版本号。
 *
 * 改变**向量的生成方式或存储格式**时递增。指纹随之全部变化，旧索引自然落进
 * 「不再被配置引用」里，不会出现新旧向量被当成同一种空间混用。
 * 当前版本固定了距离度量与数值布局（Float32、未归一化）。
 */
const VECTOR_SPACE_VERSION = 1;

/** 摘要的前缀，用来把它和普通十六进制串区分开。 */
const FINGERPRINT_PREFIX = 'sha256:';

/**
 * 归一化 embeddings 请求地址，作为模型身份的一部分。
 *
 * 去掉凭据、查询串与锚点（它们要么是敏感信息，要么与向量空间无关），
 * 并统一末尾斜杠。主机名由 URL 解析器统一成小写，但**路径保留大小写**——
 * 路径可能是大小写敏感的，折叠它会把两个不同的服务当成同一个。
 */
function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path === '' ? '/' : path;
    return url.toString().replace(/\/+$/, '');
  } catch {
    // 解析不了（用户填了不完整的地址）时退化为纯文本处理，保证摘要计算不会抛错
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * 拼出待哈希的字符串。
 *
 * 每个分量后面补一个 `\0`，避免「a」+「bc」和「ab」+「c」拼出同一个串。
 */
function buildDigestInput(identity: EmbeddingIdentity): string {
  const components = [
    'learn-app-embedding',
    String(VECTOR_SPACE_VERSION),
    VECTOR_DISTANCE,
    normalizeEndpoint(identity.endpoint),
    identity.modelId.trim(),
  ];
  return components.map(component => `${component}\0`).join('');
}

/**
 * 计算模型身份摘要。
 *
 * 只依赖配置即可算出，**不需要知道向量维度**——因此第一次调用接口之前就能用它查库，
 * 判断这套参数是不是已经建过索引。维度是查到记录之后才需要的。
 */
export function modelFingerprint(identity: EmbeddingIdentity): string {
  return `${FINGERPRINT_PREFIX}${sha256Hex(buildDigestInput(identity))}`;
}

/**
 * 一本书的向量是不是当前模型生成的。
 *
 * 渲染层用它判断「索引失效」，不需要知道摘要怎么算。书籍上记的是**摘要**而不是地址
 * （注册表只存摘要），所以这里一边收摘要、一边收身份，比较在内部完成。
 */
export function isSameModel(bookFingerprint: string | null, current: EmbeddingIdentity): boolean {
  return bookFingerprint !== null && bookFingerprint === modelFingerprint(current);
}

/** SHA-256 的轮常量。 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 循环右移。 */
function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * SHA-256，输出十六进制小写。
 *
 * 自己实现而不用 `crypto.subtle`，是因为它**必须同步**：渲染层拿它做纯派生
 * （配置 → 指纹），异步版本会把纯派生变回「订阅 + 写 store」的副作用。
 * 而 `node:crypto` 在渲染层不存在，两端就用不了同一份实现——那正是要避免的漂移。
 *
 * 它只用于身份标识，不承担任何安全职责；正确性由已知测试向量锁定。
 */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);

  // 补一个 0x80，补零到 56 (mod 64)，末尾 8 字节是大端比特长度
  const bitLength = bytes.length * 8;
  const paddedLength = bytes.length + 1 + ((56 - ((bytes.length + 1) % 64) + 64) % 64) + 8;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(value => value.toString(16).padStart(8, '0'))
    .join('');
}
