/**
 * 周报生成：结构化数据 → Markdown。
 *
 * 严格对照现有生产脚本 personal_weekly_report.py 的实现，
 * 保证产出与公司既有周报口径一致。
 *
 * 纯函数，无外部依赖，可在 Node 与浏览器中直接测试。
 */
import { fmtDate, fmtDateCn, daysBetween, parseTs, toWallClockOf, inWindow } from './week.js';
import { stripPrefix } from './classify.js';

/** 动作 → 短词（与 personal_weekly_report.py 的 action_label 完全一致） */
export function actionLabel(a) {
  const old = a.old, next = a.new;
  const remark = a.remark || '';

  if (old === '提出' && next === '待审批') return '提出需求';
  if (remark.includes('修改') && old === next) return '修改负责人';
  if (remark.includes('优先级')) return '调整优先级';
  if (remark.includes('推荐') && old === next) return '推荐实现人';
  if ((remark.includes('管理') || remark.includes('安排')) && old === next) return '调整协作人';
  if (remark.includes('将') && remark.includes('改为') && old === next) return '修改字段';

  const TRANS = {
    '待审批→待完善': '完善需求', '待完善→完善中': '完善需求',
    '待领取→待完善': '完善需求', '待审批→完善中': '完善需求',
    '研发中→待完善': '退回完善',
    '完善中→待审批': '提交审批', '待完善→待审批': '提交审批',
    '待审批→待领取': '审批通过',
    '待领取→研发中': '开始研发',
    '研发中→待验收': '提测',
    '待验收→验收中': '开始验收', '待验收→已完成': '测试完成',
    '验收中→已完成': '测试完成', '验收中→已关闭': '测试完成',
    '验收中→研发中': '回到研发',
    '待完善→已取消': '取消需求', '待领取→已取消': '取消需求',
    '已取消→待完善': '恢复需求', '研发中→待领取': '退回待领取',
  };
  const key = `${old}→${next}`;
  if (TRANS[key]) return TRANS[key];
  if (next && next !== old) return `流转到「${next}」`;
  return '操作';
}

/** 未完成且需要关注积压的阶段（与参考实现一致） */
const STUCK_STAGES = new Set(['待审批', '待完善', '完善中', '研发中', '待验收', '验收中']);
const NOT_STUCK_STAGES = new Set(['待领取', '已完成', '已关闭']);

/**
 * 判断需求当前是否"卡"在某人手上。
 * 参考实现优先用角色信息（users），但列表接口不返回该字段，
 * 因此实际回退到 current_user（已验证与角色口径一致）。
 */
export function stuckPerson(req) {
  const stage = req.progress_stage;
  if (NOT_STUCK_STAGES.has(stage)) return null;
  if (STUCK_STAGES.has(stage) && req.current_user) return req.current_user;
  return null;
}

/** 按 项目 → 板块 分组渲染表格 */
function renderByBan(rows, cols) {
  const lines = [];
  const projects = [...new Set(rows.map((r) => r[0]))].sort();
  for (const proj of projects) {
    lines.push('', `### ${proj}`);
    const sub = rows.filter((r) => r[0] === proj);
    const bans = new Map();
    for (const r of sub) {
      if (!bans.has(r[1])) bans.set(r[1], []);
      bans.get(r[1]).push(r);
    }
    for (const ban of [...bans.keys()].sort()) {
      lines.push('', `#### ${ban}`, '', `| NO. | 需求标题 | ${cols} |`, '| --- | --- | --- |');
      const sorted = [...bans.get(ban)].sort((a, b) => a[2] - b[2]);
      for (const [, , num, title, cell] of sorted) {
        lines.push(`| NO.${num} | ${title} | ${cell} |`);
      }
    }
  }
  return lines;
}

/**
 * 生成本周情况的行。
 * 只统计"本人"在窗口内的动作。
 */
export function buildCurrentRows(reqs, person, window) {
  const rows = [];
  for (const r of reqs) {
    const acts = [];
    for (const a of r.activities || []) {
      if (a.user !== person || !a.at) continue;
      const t = parseTs(a.at);
      if (t && inWindow(t, window)) acts.push(actionLabel(a));
    }
    if (acts.length) {
      rows.push([r.project, r.ban, r.requirement_num, stripPrefix(r.title), acts.join('、')]);
    }
  }
  return rows;
}

/** 生成当前积压的行 */
export function buildBacklogRows(reqs, person, now = new Date()) {
  const rows = [];
  for (const r of reqs) {
    if (stuckPerson(r) !== person) continue;
    const updated = parseTs(r.progress_updated_at);
    const days = updated ? daysBetween(toWallClockOf(updated), now) : '?';
    rows.push([
      r.project, r.ban, r.requirement_num, stripPrefix(r.title),
      `${r.progress_stage} · 卡住${days}天`,
    ]);
  }
  return rows;
}

/**
 * 生成完整周报 Markdown。
 * @param {object} opts
 * @param {string} opts.person 登录用户姓名
 * @param {{start:Date,end:Date,startWall:Date,endWall:Date}} opts.window
 * @param {Array} opts.requirements 需求数组（含 activities 与 ban）
 * @param {Date} [opts.now]
 * @returns {string}
 */
export function buildReport({ person, window, requirements, now = new Date() }) {
  const curRows = buildCurrentRows(requirements, person, window);
  const blRows = buildBacklogRows(requirements, person, now);

  const L = [
    `# ${person} · 周报（${fmtDate(window.startWall)} ~ ${fmtDate(window.endWall)}）`,
    '',
    `> 窗口：**${fmtDateCn(window.startWall)} 14:00** ~ **${fmtDateCn(window.endWall)} 14:00** ｜ ` +
      `本周 **${curRows.length} 条需求**有进展 ｜ 当前积压 **${blRows.length} 条**`,
    '',
    '## 本周情况',
    '',
  ];

  if (curRows.length) {
    L.push(...renderByBan(curRows, '动作'));
    L.push('');
  } else {
    L.push('本周无需求进展。', '');
  }

  L.push('## 当前积压（未完成）', '');
  if (blRows.length) {
    L.push(...renderByBan(blRows, '状态和卡住时间'));
    L.push('');
  } else {
    L.push('- （无）', '');
  }

  L.push('## 下周计划', '', '- （待补充）', '');
  L.push('---', '', '*本文件由脚本生成，可直接在文档内编辑补充。*');

  return L.join('\n').replace(/\s+$/, '') + '\n';
}

export const _internal = { renderByBan, STUCK_STAGES, NOT_STUCK_STAGES };
