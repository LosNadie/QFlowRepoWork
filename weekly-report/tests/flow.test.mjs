/**
 * 浏览器环境验证：把 app.js 的完整流程在 Node 中跑一遍，
 * 验证除"扫码"与"目录选择"（需真人交互）之外的所有环节。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 用真实令牌模拟"已登录"状态
const token = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.qzhuli-cli', 'qflow-credentials.json'), 'utf8')
).accessToken;

const { fetchParticipated, fetchAllActivities } = await import('../src/qflow.js');
const { classify } = await import('../src/classify.js');
const { weekWindow, reportFileName, fmtDateCn } = await import('../src/week.js');
const { buildReport } = await import('../src/report.js');
const { isSupported } = await import('../src/picker.js');

let pass = 0, fail = 0;
const check = (cond, label) => {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

console.log('=== 模拟浏览器完整流程（2026-10-16 14:00）===');
const NOW = new Date(Date.UTC(2026, 9, 16, 6, 0, 0));
const person = '黄捷';

// 步骤 1：模拟登录后的状态
const state = {
  qflow: { accessToken: token },
  person,
  window: weekWindow(NOW),
  requirements: [],
  selected: new Set(),
};

console.log('\n[窗口]');
console.log('  ' + fmtDateCn(state.window.startWall) + ' 14:00 ~ ' + fmtDateCn(state.window.endWall) + ' 14:00');
check(state.window.startWall.getUTCDate() === 9, '起始为 10-09');
check(state.window.endWall.getUTCDate() === 16, '结束为 10-16');

// 步骤 2：取数
console.log('\n[取数]');
const reqs = await fetchParticipated(state.qflow.accessToken);
const { ok, failed } = await fetchAllActivities(state.qflow.accessToken, reqs);
check(reqs.length > 0, `participated 返回 ${reqs.length} 条`);
check(failed.length === 0, `动态拉取无失败`);

for (const r of ok) r.ban = classify(r.project, r.title, r.requirement_num);

// 模拟 app.js 的过滤：保留「当前负责人是我」或「窗口内有我动作」的需求
const hasMyActionInWin = (r) =>
  (r.activities || []).some((a) => {
    if (a.user !== state.person || !a.at) return false;
    const t = new Date(a.at);
    return !Number.isNaN(t.getTime()) &&
      t.getTime() >= state.window.start.getTime() &&
      t.getTime() < state.window.end.getTime();
  });

const relevant = ok.filter((r) => r.current_user === state.person || hasMyActionInWin(r));
state.requirements = relevant;
state.selected = new Set(relevant.map((r) => r.requirement_id));

const winCount = relevant.filter(hasMyActionInWin).length;
// 修复后为 16 条。修复前只拉 participated（仅返回进行中），只有 6 条，
// 漏掉 8 条已完成 + 1 条已取消 + 1 条待审批。
check(winCount === 16, `窗口内有动作的需求 16 条（实际 ${winCount}）`);
check(relevant.length >= winCount, `相关需求 ${relevant.length} 条 ≥ 本周有动作 ${winCount} 条`);
check(state.selected.size === relevant.length, '默认全选');

// 关键回归：必须包含「已完成」的需求 —— 验收完成同样代表工作量
const completedInWin = relevant.filter(
  (r) => r.progress_stage === '已完成' && hasMyActionInWin(r)
);
check(completedInWin.length > 0,
  `包含已完成需求 ${completedInWin.length} 条（修复前为 0）`);

// 步骤 3：生成
console.log('\n[生成]');
const chosen = state.requirements.filter((r) => state.selected.has(r.requirement_id));
const md = buildReport({ person: state.person, window: state.window, requirements: chosen, now: NOW });
const fname = reportFileName(state.person, state.window);
check(md.length > 0, `生成 ${md.length} 字符`);
check(fname === '黄捷-10月9日-10月16日周报.md', `文件名 ${fname}`);
check(md.startsWith('# 黄捷 · 周报（2026-10-09 ~ 2026-10-16）'), '标题正确');
check(md.includes('## 本周情况'), '含本周情况');
check(md.includes('## 当前积压（未完成）'), '含当前积压');
check(md.includes('## 下周计划'), '含下周计划');
check(!md.includes('学习'), '不含学习章节');
check(md.includes('NO.788'), '含 NO.788');
check(!md.includes('【新功能】'), '无标题前缀残留');

// 与 Python 基准比对
const expected = fs.readFileSync(path.join(HERE, 'fixtures/expected_report_0.md'), 'utf8').replace(/\r\n/g, '\n');
check(md === expected, '与 Python 参考实现逐字节一致');

// 环境能力探测
console.log('\n[环境能力]');
console.log(`  目录选择 API（Node 环境预期为 false）: ${isSupported()}`);

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);

