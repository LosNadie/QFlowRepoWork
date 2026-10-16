/**
 * qflow.js + auth.js 集成测试。
 * 使用本机 qz 的 QFlow 令牌，真实调用接口（只读）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchParticipated, fetchActivities, fetchAllActivities, fetchMe } from '../src/qflow.js';
import { parseLoginData } from '../src/auth.js';

let pass = 0, fail = 0;
function eq(a, b, label) {
  if (a === b) pass++;
  else { fail++; console.log(`  FAIL ${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
}

console.log('=== 1) parseLoginData 解析 ===');
{
  eq(parseLoginData(null), null, 'null');
  eq(parseLoginData({}), null, '空对象');
  eq(parseLoginData({ uid: 'u', tk: 't' }), null, '缺 token');
  const ok = parseLoginData({ uid: 'u', tk: 't', token: 'tok', nickname: '张三', cid: 'c' });
  eq(ok?.uid, 'u', 'uid');
  eq(ok?.nickname, '张三', 'nickname');
  eq(ok?.cid, 'c', 'cid');
  eq(ok?.authMethod, 'qr_code', 'authMethod');
  // user_id / device_id 别名
  const alias = parseLoginData({ user_id: 'u2', tk: 't', token: 'tok', device_id: 'd2' });
  eq(alias?.uid, 'u2', 'user_id 别名');
  eq(alias?.cid, 'd2', 'device_id 别名');
}

const credPath = path.join(os.homedir(), '.qzhuli-cli', 'qflow-credentials.json');
if (!fs.existsSync(credPath)) {
  console.log('\n未找到 QFlow 凭据，跳过在线测试');
  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail === 0 ? 0 : 1);
}
const token = JSON.parse(fs.readFileSync(credPath, 'utf8')).accessToken;

console.log('\n=== 2) fetchMe（令牌有效性）===');
try {
  const me = await fetchMe(token);
  console.log(`  当前用户: ${me?.nickname || me?.user?.nickname || JSON.stringify(me).slice(0, 80)}`);
  pass++;
} catch (e) {
  fail++; console.log('  FAIL:', e.message);
}

console.log('\n=== 3) fetchParticipated（自动翻页）===');
let reqs = [];
try {
  reqs = await fetchParticipated(token, {
    onProgress: ({ loaded, total }) => console.log(`  已加载 ${loaded}/${total}`),
  });
  console.log(`  共 ${reqs.length} 条`);
  eq(reqs.length > 0, true, '有数据');
  const first = reqs[0];
  eq(typeof first.requirement_id === 'string' && first.requirement_id.startsWith('r-'), true, 'requirement_id 格式');
  eq(typeof first.project === 'string' && first.project.length > 0, true, 'project 非空');
  eq(typeof first.title === 'string' && first.title.length > 0, true, 'title 非空');
  eq(typeof first.progress_stage === 'string', true, 'progress_stage 存在');
  pass++;
} catch (e) {
  fail++; console.log('  FAIL:', e.message);
}

console.log('\n=== 4) fetchActivities（单条）===');
if (reqs.length) {
  try {
    const acts = await fetchActivities(token, reqs[0].requirement_id);
    console.log(`  NO.${reqs[0].requirement_num} 动态 ${acts.length} 条`);
    eq(Array.isArray(acts), true, '返回数组');
    if (acts.length) {
      eq(typeof acts[0].user === 'string', true, 'user 字段');
      eq(typeof acts[0].at === 'string', true, 'at 字段');
      eq('old' in acts[0] && 'new' in acts[0], true, 'old/new 字段');
    }
    pass++;
  } catch (e) {
    fail++; console.log('  FAIL:', e.message);
  }
}

console.log('\n=== 5) fetchAllActivities（并发 + 容错）===');
if (reqs.length) {
  try {
    const t0 = Date.now();
    const { ok, failed } = await fetchAllActivities(token, reqs, {
      onProgress: ({ done, total }) => { if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}`); },
    });
    const ms = Date.now() - t0;
    console.log(`  完成 ${ok.length} 条，失败 ${failed.length} 条，耗时 ${ms}ms`);
    eq(ok.length, reqs.length, '全部返回');
    eq(ok.every((r) => Array.isArray(r.activities)), true, '每条都有 activities 数组');
    const withActs = ok.filter((r) => r.activities.length > 0).length;
    console.log(`  其中 ${withActs} 条有动态`);
    pass++;
  } catch (e) {
    fail++; console.log('  FAIL:', e.message);
  }
}

console.log('\n=== 6) 401 处理（错误令牌）===');
try {
  await fetchMe('invalid-token-xxx');
  fail++; console.log('  FAIL: 应当抛错');
} catch (e) {
  if (e.code === 'AUTH_EXPIRED') { pass++; console.log('  OK 正确识别为登录过期'); }
  else { pass++; console.log(`  OK 抛出错误: ${e.message}`); }
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
