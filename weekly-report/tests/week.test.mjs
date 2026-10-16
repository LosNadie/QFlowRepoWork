/**
 * week.js 测试：与现有 Python 实现（personal_weekly_report.py 的 week_window）逐例比对。
 * 参考实现：
 *   days_since_friday = (now.weekday() - 4) % 7
 *   end = (now - days).replace(hour=14,...)
 *   if end > now and now.weekday() != 4: end -= 7 days
 *   start = end - 7 days
 */
import { weekWindow, reportFileName, fmtDateCn, inWindow, parseTs, daysBetween } from '../src/week.js';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.log(`  FAIL ${label}\n    actual  =${actual}\n    expected=${expected}`); }
}

// Python 参考实现（用于生成期望值）
function pyWeekWindow(now) {
  const TZ = 8 * 3600 * 1000;
  const w = new Date(now.getTime() + TZ);
  const wd = (w.getUTCDay() + 6) % 7; // Monday=0
  const dsf = (wd - 4 + 7) % 7;
  let end = new Date(w.getTime());
  end.setUTCDate(end.getUTCDate() - dsf);
  end.setUTCHours(14, 0, 0, 0);
  if (end.getTime() > w.getTime() && wd !== 4) end.setUTCDate(end.getUTCDate() - 7);
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - 7);
  return { start: new Date(start.getTime() - TZ), end: new Date(end.getTime() - TZ),
           startWall: start, endWall: end };
}

console.log('=== 1) 与 Python 参考实现逐例比对（2026-09-01 ~ 2026-12-31 每日 4 个时点）===');
let cmp = 0, mismatch = 0;
const times = [0, 6, 14, 23];
for (let d = new Date(Date.UTC(2026, 8, 1)); d <= new Date(Date.UTC(2026, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
  for (const h of times) {
    // 构造东八区挂钟时刻，再转成真实 UTC
    const wall = new Date(d.getTime());
    wall.setUTCHours(h, 30, 0, 0);
    const real = new Date(wall.getTime() - 8 * 3600 * 1000);

    const mine = weekWindow(real);
    const py = pyWeekWindow(real);
    cmp++;
    if (mine.start.getTime() !== py.start.getTime() || mine.end.getTime() !== py.end.getTime()) {
      mismatch++;
      if (mismatch <= 5) {
        console.log(`  MISMATCH at ${wall.toISOString()} (周${'一二三四五六日'[(wall.getUTCDay()+6)%7]})`);
        console.log(`    mine: ${mine.start.toISOString()} ~ ${mine.end.toISOString()}`);
        console.log(`    py  : ${py.start.toISOString()} ~ ${py.end.toISOString()}`);
      }
    }
  }
}
console.log(`  比对 ${cmp} 例，不一致 ${mismatch} 例`);
if (mismatch === 0) { pass++; console.log('  OK 与 Python 实现完全一致'); } else { fail++; }

console.log('\n=== 2) 周五 14:00 边界 ===');
{
  // 2026-10-16 是周五。14:00 整点运行
  const at = new Date(Date.UTC(2026, 9, 16, 6, 0, 0)); // 东八区 14:00
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周五14:00 end');
  eq(fmtDateCn(w.startWall), '2026-10-09（周五）', '周五14:00 start');
}
{
  // 周五 13:59（尚未到 14:00）→ 仍以今天 14:00 为窗口终点。
  // 这是参考实现的有意行为：Python 条件为 `if end > now and now.weekday() != 4`，
  // 周五任何时刻都不回退，因为定时任务固定在周五 14:00 触发、正好闭合。
  const at = new Date(Date.UTC(2026, 9, 16, 5, 59, 0)); // 东八区 13:59
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周五13:59 end 不回退');
  eq(fmtDateCn(w.startWall), '2026-10-09（周五）', '周五13:59 start');
}
{
  // 周五 14:01 → 已过 14:00，窗口闭合于今天
  const at = new Date(Date.UTC(2026, 9, 16, 6, 1, 0));
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周五14:01 end');
}

console.log('\n=== 3) 非周五手动运行 ===');
{
  // 2026-10-14 周三 → 回退到最近已过的周五 10-09
  const at = new Date(Date.UTC(2026, 9, 14, 4, 0, 0)); // 东八区 12:00
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-09（周五）', '周三 end');
  eq(fmtDateCn(w.startWall), '2026-10-02（周五）', '周三 start');
}
{
  // 2026-10-19 周一 → 最近已过周五是 10-16
  const at = new Date(Date.UTC(2026, 9, 19, 4, 0, 0));
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周一 end');
}
{
  // 2026-10-17 周六 → 最近已过周五是 10-16
  const at = new Date(Date.UTC(2026, 9, 17, 4, 0, 0));
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周六 end');
}
{
  // 2026-10-18 周日
  const at = new Date(Date.UTC(2026, 9, 18, 4, 0, 0));
  const w = weekWindow(at);
  eq(fmtDateCn(w.endWall), '2026-10-16（周五）', '周日 end');
}

console.log('\n=== 4) 文件名 ===');
{
  const at = new Date(Date.UTC(2026, 9, 16, 6, 0, 0));
  const w = weekWindow(at);
  eq(reportFileName('黄捷', w), '黄捷-10月9日-10月16日周报.md', '文件名');
  eq(reportFileName('', w), '未登录-10月9日-10月16日周报.md', '空姓名兜底');
}

console.log('\n=== 5) 窗口半开区间 [start, end) ===');
{
  const at = new Date(Date.UTC(2026, 9, 16, 6, 0, 0));
  const w = weekWindow(at);
  eq(inWindow(w.start, w), true, 'start 含');
  eq(inWindow(w.end, w), false, 'end 不含');
  eq(inWindow(new Date(w.end.getTime() - 1), w), true, 'end-1ms 含');
}

console.log('\n=== 6) 时间戳解析 ===');
{
  eq(parseTs('2026-10-16T02:56:05.874793+00:00')?.toISOString(), '2026-10-16T02:56:05.874Z', '带 +00:00');
  eq(parseTs('2026-10-16T02:56:05Z')?.toISOString(), '2026-10-16T02:56:05.000Z', '带 Z');
  eq(parseTs(''), null, '空串');
  eq(parseTs(null), null, 'null');
  eq(parseTs('not-a-date'), null, '非法');
}

console.log('\n=== 7) 卡住天数 ===');
{
  const from = new Date(Date.UTC(2026, 9, 6, 2, 0, 0)); // 东八区 10-06
  const now = new Date(Date.UTC(2026, 9, 16, 2, 0, 0)); // 东八区 10-16
  eq(daysBetween(from, now), 10, '10-06 → 10-16 = 10 天');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
