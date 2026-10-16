/**
 * 端到端验证：真实令牌 → 取数 → 归类 → 生成周报。
 *
 * 与 app.js 的行为保持一致：
 *   - 列表只显示「本周有我的动作」的需求（inWin）
 *   - 报告生成用全集（allRequirements），以便「当前积压」算准
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchParticipated, fetchAllActivities } from '../src/qflow.js';
import { classify } from '../src/classify.js';
import { weekWindow, reportFileName, fmtDateCn } from '../src/week.js';
import { buildReport } from '../src/report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const token = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.qzhuli-cli', 'qflow-credentials.json'), 'utf8')
).accessToken;

const NOW = new Date(Date.UTC(2026, 9, 16, 6, 0, 0)); // 2026-10-16 14:00 东八区
const person = '黄捷';

let pass = 0, fail = 0;
const check = (cond, label) => {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const state = {
  qflow: { accessToken: token },
  person,
  window: weekWindow(NOW),
  requirements: [],
  allRequirements: [],
  selected: new Set(),
};

console.log('=== 模拟浏览器完整流程（2026-10-16 14:00）===');

console.log('\n[窗口]');
console.log('  ' + fmtDateCn(state.window.startWall) + ' 14:00 ~ ' + fmtDateCn(state.window.endWall) + ' 14:00');
check(state.window.startWall.getUTCDate() === 9, '起始为 10-09');
check(state.window.endWall.getUTCDate() === 16, '结束为 10-16');

// 步骤 2：取数（按阶段，含已完成）
console.log('\n[取数]');
const reqs = await fetchParticipated(state.qflow.accessToken);
const { ok, failed } = await fetchAllActivities(state.qflow.accessToken, reqs);
check(reqs.length === 87, `拉取需求 87 条（实际 ${reqs.length}）`);
check(failed.length === 0, `动态拉取无失败`);

for (const r of ok) r.ban = classify(r.project, r.title, r.requirement_num);

// 判断某需求在窗口内是否有"本人"动作（与 app.js 一致）
const hasMyActionInWin = (r) => (r.activities || []).some((a) => {
  if (a.user !== state.person || !a.at) return false;
  const t = new Date(a.at);
  return !Number.isNaN(t.getTime()) &&
    t >= state.window.start &&
    t < state.window.end;
});

// 列表只显示「本周有我的动作」的需求（与 app.js 一致）
const inWin = ok.filter(hasMyActionInWin);
state.requirements = inWin;          // 列表显示 / 用户勾选
state.allRequirements = ok;          // 全集：供「当前积压」计算
state.selected = new Set(inWin.map((r) => r.requirement_id));

check(inWin.length === 16, `列表显示本周有动作的需求 16 条（实际 ${inWin.length}）`);
check(state.selected.size === inWin.length, '默认全选');

// 关键回归 1：必须包含「已完成」的需求 —— 验收完成同样代表工作量
const completedInWin = inWin.filter((r) => r.progress_stage === '已完成');
check(completedInWin.length === 8,
  `其中已完成 8 条（实际 ${completedInWin.length}，修复前为 0）`);

// 关键回归 2：列表不能包含「本周无我的动作」的需求
const noAction = inWin.filter((r) => !hasMyActionInWin(r));
check(noAction.length === 0, `列表不含本周无动作的需求（实际 ${noAction.length} 条）`);
check(inWin.length < ok.length,
  `列表(${inWin.length}) < 全集(${ok.length})，不再把 63 条都列出来`);

// 步骤 3：生成 —— 报告输入用全集（积压需要全集才能算准）
console.log('\n[生成]');
const chosen = inWin.filter((r) => state.selected.has(r.requirement_id));
const reportInput = ok;   // 无取消勾选时，输入即全集
const md = buildReport({ person: state.person, window: state.window, requirements: reportInput, now: NOW });
const fname = reportFileName(state.person, state.window);

check(chosen.length === 16, `勾选 16 条（实际 ${chosen.length}）`);
check(md.length > 0, `生成 ${md.length} 字符`);
check(fname === '黄捷-10月9日-10月16日周报.md', `文件名 ${fname}`);
check(md.startsWith('# 黄捷 · 周报（2026-10-09 ~ 2026-10-16）'), '标题正确');
check(md.includes('## 本周情况'), '含本周情况');
check(md.includes('## 当前积压（未完成）'), '含当前积压');
check(md.includes('## 下周计划'), '含下周计划');
check(!md.includes('学习'), '不含学习章节');
check(md.includes('NO.788'), '含 NO.788');
check(!md.includes('【新功能】'), '无标题前缀残留');

// 与 Python 参考实现逐字节比对
const expected = fs.readFileSync(path.join(HERE, 'fixtures/expected_report_0.md'), 'utf8').replace(/\r\n/g, '\n');
check(md === expected, '与 Python 参考实现逐字节一致');

console.log('\n[环境能力]');
console.log(`  目录选择 API（Node 环境预期为 false）: ${(await import('../src/picker.js')).isSupported()}`);

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
