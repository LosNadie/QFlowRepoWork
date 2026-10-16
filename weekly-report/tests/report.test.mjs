/**
 * report.js 测试：与 Python 原版 personal_weekly_report.py 逐字节比对。
 * 期望值由 tests/fixtures/gen_expected_report.py 用真实数据生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, actionLabel, stuckPerson } from '../src/report.js';
import { weekWindow } from '../src/week.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const reqs = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/requirements_with_acts.json'), 'utf8'));
const banmap = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/expected_ban.json'), 'utf8'));
const expectedRaw = fs.readFileSync(path.join(HERE, 'fixtures/expected_report_0.md'), 'utf8');
// Python 在 Windows 文本模式下写盘会把 \n 转为 \r\n；归一化后比对内容
const expected = expectedRaw.replace(/\r\n/g, '\n');

let pass = 0, fail = 0;

// 挂载板块（与 Python 侧一致）
for (const r of reqs) r.ban = banmap[r.requirement_id] || '通用/未分类';

// 固定 now = 2026-10-16 14:00 东八区
const NOW = new Date(Date.UTC(2026, 9, 16, 6, 0, 0));
const window = weekWindow(NOW);

console.log('=== 1) 与 Python 参考实现逐字节比对 ===');
const actual = buildReport({ person: '黄捷', window, requirements: reqs, now: NOW });

if (actual === expected) {
  pass++;
  console.log(`  OK 完全一致（${actual.length} 字符，${actual.split('\n').length} 行）`);
} else {
  fail++;
  const a = actual.split('\n'), e = expected.split('\n');
  console.log(`  不一致：JS ${a.length} 行 / PY ${e.length} 行`);
  let shown = 0;
  for (let i = 0; i < Math.max(a.length, e.length) && shown < 15; i++) {
    if (a[i] !== e[i]) {
      console.log(`    行 ${i + 1}:`);
      console.log(`      JS = ${JSON.stringify(a[i])}`);
      console.log(`      PY = ${JSON.stringify(e[i])}`);
      shown++;
    }
  }
}

console.log('\n=== 1b) 多窗口批量比对（9 个窗口，含空周/非周五回退）===');
{
  const list = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/expected_reports.json'), 'utf8'));
  let multiFail = 0;
  for (const item of list) {
    const now = new Date(item.now);
    const w = weekWindow(now);
    const got = buildReport({ person: '黄捷', window: w, requirements: reqs, now });
    const want = fs.readFileSync(path.join(HERE, 'fixtures', item.file), 'utf8').replace(/\r\n/g, '\n');
    if (got === want) {
      pass++;
    } else {
      multiFail++; fail++;
      const a = got.split('\n'), e = want.split('\n');
      console.log(`  FAIL 窗口 ${item.now}`);
      for (let i = 0; i < Math.max(a.length, e.length); i++) {
        if (a[i] !== e[i]) {
          console.log(`    行 ${i + 1}: JS=${JSON.stringify(a[i])}  PY=${JSON.stringify(e[i])}`);
          break;
        }
      }
    }
  }
  console.log(multiFail === 0 ? `  OK ${list.length} 个窗口全部逐字节一致` : `  失败 ${multiFail} 个`);
}

console.log('\n=== 2) actionLabel 映射（对照 Python trans 表）===');
function eq(a, b, label) {
  if (a === b) pass++;
  else { fail++; console.log(`  FAIL ${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
}
eq(actionLabel({ old: '提出', new: '待审批', remark: '需求提出' }), '提出需求', '提出');
eq(actionLabel({ old: '待审批', new: '待完善', remark: '' }), '完善需求', '待审批→待完善');
eq(actionLabel({ old: '待领取', new: '待完善', remark: '' }), '完善需求', '待领取→待完善');
eq(actionLabel({ old: '待审批', new: '待领取', remark: '' }), '审批通过', '审批通过');
eq(actionLabel({ old: '待领取', new: '研发中', remark: '' }), '开始研发', '开始研发');
eq(actionLabel({ old: '研发中', new: '待验收', remark: '' }), '提测', '提测');
eq(actionLabel({ old: '验收中', new: '已完成', remark: '' }), '测试完成', '测试完成');
eq(actionLabel({ old: '研发中', new: '待领取', remark: '' }), '退回待领取', '退回待领取');
eq(actionLabel({ old: '完善中', new: '完善中', remark: '黄捷将需求优先级从"高"改为"中"' }), '调整优先级', '调优先级');
eq(actionLabel({ old: '完善中', new: '完善中', remark: '修改 完善人 为 黄捷' }), '修改负责人', '换负责人');
eq(actionLabel({ old: '完善中', new: '完善中', remark: '将终端从"全部"改为"Android"' }), '修改字段', '改字段');
eq(actionLabel({ old: '待领取', new: '待领取', remark: '推荐了实现人' }), '推荐实现人', '推荐实现人');
eq(actionLabel({ old: 'X', new: 'Y', remark: '' }), '流转到「Y」', '未知流转');
eq(actionLabel({ old: 'X', new: 'X', remark: '' }), '操作', '兜底');

console.log('\n=== 3) stuckPerson 口径 ===');
eq(stuckPerson({ progress_stage: '待领取', current_user: '黄捷' }), null, '待领取 不算积压');
eq(stuckPerson({ progress_stage: '已完成', current_user: '黄捷' }), null, '已完成 不算积压');
eq(stuckPerson({ progress_stage: '已关闭', current_user: '黄捷' }), null, '已关闭 不算积压');
eq(stuckPerson({ progress_stage: '完善中', current_user: '黄捷' }), '黄捷', '完善中 算积压');
eq(stuckPerson({ progress_stage: '完善中', current_user: '' }), null, '无负责人');

console.log('\n=== 4) 边界：空数据 ===');
{
  const w = weekWindow(NOW);
  const empty = buildReport({ person: '黄捷', window: w, requirements: [], now: NOW });
  eq(empty.includes('本周无需求进展。'), true, '空周提示');
  eq(empty.includes('- （无）'), true, '空积压提示');
  eq(empty.includes('## 下周计划'), true, '含下周计划');
  eq(empty.includes('学习'), false, '不含学习章节');
}

console.log('\n=== 5) 边界：只含他人动作 ===');
{
  const w = weekWindow(NOW);
  const onlyOthers = [{
    project: 'Q助理', ban: '消息与聊天', requirement_num: 1, title: 'T',
    progress_stage: '待领取', current_user: '别人', progress_updated_at: '2026-10-15T00:00:00+08:00',
    activities: [{ user: '别人', at: '2026-10-15T10:00:00+08:00', old: '提出', new: '待审批', remark: '' }],
  }];
  const t = buildReport({ person: '黄捷', window: w, requirements: onlyOthers, now: NOW });
  eq(t.includes('本周无需求进展。'), true, '他人动作不计入');
}

console.log('\n=== 6) 边界：窗口外的动作被排除 ===');
{
  const w = weekWindow(NOW);
  const outside = [{
    project: 'Q助理', ban: '消息与聊天', requirement_num: 2, title: 'T',
    progress_stage: '待领取', current_user: '黄捷', progress_updated_at: '2026-10-15T00:00:00+08:00',
    activities: [
      { user: '黄捷', at: '2026-10-01T10:00:00+08:00', old: '提出', new: '待审批', remark: '' },
      { user: '黄捷', at: '2026-10-15T10:00:00+08:00', old: '待审批', new: '待领取', remark: '' },
    ],
  }];
  const t = buildReport({ person: '黄捷', window: w, requirements: outside, now: NOW });
  eq(t.includes('提出需求'), false, '窗口外动作排除');
  eq(t.includes('审批通过'), true, '窗口内动作保留');
}

console.log('\n=== 7) 需求标题前缀被剥离 ===');
{
  const w = weekWindow(NOW);
  const prefixed = [{
    project: 'Q助理', ban: 'NAS同步', requirement_num: 3, title: '【新功能】NAS同步文档',
    progress_stage: '待领取', current_user: '黄捷', progress_updated_at: '2026-10-15T00:00:00+08:00',
    activities: [{ user: '黄捷', at: '2026-10-15T10:00:00+08:00', old: '提出', new: '待审批', remark: '' }],
  }];
  const t = buildReport({ person: '黄捷', window: w, requirements: prefixed, now: NOW });
  eq(t.includes('| NO.3 | NAS同步文档 |'), true, '前缀已剥离');
  eq(t.includes('【新功能】'), false, '无前缀残留');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
