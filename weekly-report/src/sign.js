/**
 * Q助理客户端接口签名。
 *
 * 算法从 @qzhuli/qzhuli-cli v0.5.8 的 dist/cmd.js 反解，并已实测验证：
 *   buildParams → 参数含 r(16字节hex) / uid / tk / base
 *   签名 = MD5( 按 key 字典序拼接 "k=v" 以 & 连接，末尾追加 "token=<token>" )
 *   key 与 base 不参与签名
 *   请求体为 application/x-www-form-urlencoded
 *
 * 纯函数（除随机数外），可在 Node 与浏览器中直接测试。
 */
import md5 from '../vendor/md5.esm.js';

const BASE_INFO = JSON.stringify({ platform: 'cli', version: '0.1.0' });

/** 生成 16 字节随机 hex（等价于 Node 的 crypto.randomBytes(16).toString('hex')） */
export function randomHex16() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 计算签名。
 * @param {Record<string,string>} params 已含 r/uid/tk 及业务参数（不含 key/base）
 * @param {string|undefined} token 登录令牌，参与签名
 * @returns {string} 32 位小写 hex
 */
export function calculateSignature(params, token) {
  const sorted = Object.entries(params)
    .filter(([k]) => k !== 'key' && k !== 'base')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  if (token) sorted.push(`token=${token}`);
  return md5(sorted.join('&'));
}

/**
 * 构造完整请求参数（含 r / uid / tk / key / base）。
 * @param {Record<string,any>} params 业务参数
 * @param {{uid:string, tk:string, token:string}|null} auth 登录态；为 null 表示免鉴权
 * @returns {Record<string,string>}
 */
export function buildParams(params, auth) {
  const result = { r: randomHex16() };

  if (auth) {
    result.uid = auth.uid;
    result.tk = auth.tk;
  }

  for (const [k, v] of Object.entries(params || {})) {
    // 与参考实现一致：空字符串跳过；非字符串一律 String()
    if (typeof v === 'string' && v.length > 0) result[k] = v;
    else if (typeof v !== 'string') result[k] = String(v);
  }

  result.key = calculateSignature(result, auth ? auth.token : undefined);
  result.base = BASE_INFO;
  return result;
}

/** 表单编码（application/x-www-form-urlencoded） */
export function encodeForm(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export const _internal = { BASE_INFO };
