/**
 * sign.js 测试。
 *
 * 黄金对照：qz --dry-run 的真实输出（固定输入 → 固定 key）。
 * 由于 r 是随机的，测试用固定 r 复现 key。
 */
import { calculateSignature, buildParams, encodeForm, randomHex16 } from '../src/sign.js';
import nodeCrypto from 'node:crypto';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) pass++;
  else { fail++; console.log(`  FAIL ${label}\n    actual  =${actual}\n    expected=${expected}`); }
}

// ===== 黄金对照数据 =====
// 来自：qz --dry-run friend list
// Body: r=f7ca838f37238a59e81984066d25a4e2&uid=05f8269927c140dda5fb2320
//       &tk=p_MbLKvZvjSrYkDnKmNnTBFHVd&key=cb41b876e718b5374fb893bee9a37898
//       &base={"platform":"cli","version":"0.1.0"}
const GOLDEN = {
  r: 'f7ca838f37238a59e81984066d25a4e2',
  uid: '05f8269927c140dda5fb2320',
  tk: 'p_MbLKvZvjSrYkDnKmNnTBFHVd',
  key: 'cb41b876e718b5374fb893bee9a37898',
  base: '{"platform":"cli","version":"0.1.0"}',
};

console.log('=== 1) 复现 qz --dry-run 的签名（黄金对照）===');
{
  // token 取自本机凭据（qz 用真实 token 参与签名）
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const credPath = path.join(os.homedir(), '.qzhuli-cli', 'credentials.json');
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));

  const params = { r: GOLDEN.r, uid: GOLDEN.uid, tk: GOLDEN.tk };
  const key = calculateSignature(params, cred.token);
  eq(key, GOLDEN.key, '签名复现（get_links_contacts）');
  console.log(`  计算 key = ${key}`);
  console.log(`  期望 key = ${GOLDEN.key}`);
}

console.log('\n=== 2) 无 token 时签名 ===');
{
  const key = calculateSignature({ r: 'abc', uid: 'u1' }, undefined);
  const expect = nodeCrypto.createHash('md5').update('r=abc&uid=u1').digest('hex');
  eq(key, expect, '无 token');
}

console.log('\n=== 3) key 与 base 不参与签名 ===');
{
  const a = calculateSignature({ r: 'x', uid: 'u', key: 'IGNORED', base: 'IGNORED' }, 'tok');
  const b = calculateSignature({ r: 'x', uid: 'u' }, 'tok');
  eq(a, b, 'key/base 被排除');
}

console.log('\n=== 4) 字典序排序（非插入序）===');
{
  // 插入顺序与字典序不同，结果应一致
  const a = calculateSignature({ z: '1', a: '2', m: '3' }, undefined);
  const b = calculateSignature({ a: '2', m: '3', z: '1' }, undefined);
  eq(a, b, '顺序无关');
  const expect = nodeCrypto.createHash('md5').update('a=2&m=3&z=1').digest('hex');
  eq(a, expect, '按字典序拼接');
}

console.log('\n=== 5) token 追加在末尾 ===');
{
  const key = calculateSignature({ a: '1', b: '2' }, 'TOK');
  const expect = nodeCrypto.createHash('md5').update('a=1&b=2&token=TOK').digest('hex');
  eq(key, expect, 'token 末尾');
}

console.log('\n=== 6) buildParams 结构 ===');
{
  const auth = { uid: 'U', tk: 'T', token: 'TOKEN' };
  const p = buildParams({ foo: 'bar' }, auth);
  eq(typeof p.r, 'string', 'r 存在');
  eq(p.r.length, 32, 'r 为 32 位 hex');
  eq(/^[0-9a-f]{32}$/.test(p.r), true, 'r 为小写 hex');
  eq(p.uid, 'U', 'uid 注入');
  eq(p.tk, 'T', 'tk 注入');
  eq(p.foo, 'bar', '业务参数保留');
  eq(p.base, GOLDEN.base, 'base 正确');
  eq(p.key.length, 32, 'key 为 32 位');
  eq(calculateSignature({ r: p.r, uid: 'U', tk: 'T', foo: 'bar' }, 'TOKEN'), p.key, 'key 可复现');
}

console.log('\n=== 7) buildParams 免鉴权（无 uid/tk）===');
{
  const p = buildParams({ scene_id: 'S' }, null);
  eq(p.uid, undefined, '无 uid');
  eq(p.tk, undefined, '无 tk');
  eq(p.scene_id, 'S', '业务参数保留');
  eq(calculateSignature({ r: p.r, scene_id: 'S' }, undefined), p.key, 'key 可复现');
}

console.log('\n=== 8) 空字符串跳过，非字符串转 String ===');
{
  const p = buildParams({ empty: '', zero: 0, num: 42, bool: true }, null);
  eq('empty' in p, false, '空串跳过');
  eq(p.zero, '0', '数字 0 保留');
  eq(p.num, '42', '数字转字符串');
  eq(p.bool, 'true', '布尔转字符串');
}

console.log('\n=== 9) 表单编码 ===');
{
  const body = encodeForm({ base: GOLDEN.base, r: 'abc' });
  eq(body.includes('base=%7B%22platform%22'), true, 'base 被 URL 编码');
  eq(body.includes('r=abc'), true, '普通值不额外编码');
  // 与 qz 输出格式比对：encodeForm 保持对象插入序（qz 的 body 也是插入序）
  const expectedPrefix = 'base=';  // 对象字面量中 base 先声明，故在前
  eq(body.startsWith(expectedPrefix), true, '保持插入序');
}

console.log('\n=== 10) randomHex16 唯一性 ===');
{
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(randomHex16());
  eq(set.size, 1000, '1000 次无重复');
  eq(randomHex16().length, 32, '长度 32');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
