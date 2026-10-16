/**
 * 周窗口计算与文件命名。
 *
 * 口径（沿用公司现有周报系统，历轮验收定稿）：
 *   上周五 14:00（含）~ 本周五 14:00（不含）为一个自然周。
 *   非周五手动运行时，回退到最近一个已过去的周五 14:00。
 *
 * 时区：所有计算基于本地时区（Asia/Shanghai, UTC+8）。
 * 纯函数，无外部依赖，可在 Node 与浏览器中直接测试。
 */

const TZ_OFFSET_HOURS = 8;
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const FRIDAY = 4; // Date.getDay(): 周日=0 … 周五=5；此处用 weekday 索引（周一=0）

/**
 * 把一个时间点转成"东八区挂钟时间"的 Date。
 * 做法：先按 UTC 读，再整体平移 TZ_OFFSET_HOURS 小时，
 * 之后一律用 getUTC* 读取，避免宿主机时区干扰。
 */
function toWallClock(date) {
  return new Date(date.getTime() + TZ_OFFSET_HOURS * 3600 * 1000);
}

/** 从"东八区挂钟" Date 还原为真实 UTC 时刻 */
function fromWallClock(wall) {
  return new Date(wall.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
}

/** 挂钟 Date → 周一=0 … 周日=6 */
function weekdayIndex(wall) {
  return (wall.getUTCDay() + 6) % 7;
}

/**
 * 计算周窗口。
 * @param {Date} now 当前时刻
 * @returns {{start: Date, end: Date, startWall: Date, endWall: Date}}
 *   start/end 为真实时刻；startWall/endWall 为东八区挂钟时间，用于展示
 */
export function weekWindow(now = new Date()) {
  const wall = toWallClock(now);
  const wd = weekdayIndex(wall); // 周一=0 … 周五=4 … 周日=6

  // 距最近一个周五的天数
  const daysSinceFriday = (wd - FRIDAY + 7) % 7;

  const endWall = new Date(wall.getTime());
  endWall.setUTCDate(endWall.getUTCDate() - daysSinceFriday);
  endWall.setUTCHours(14, 0, 0, 0);

  // 非周五时，若算出的"本周五 14:00"还没到，则回退一周
  if (endWall.getTime() > wall.getTime() && wd !== FRIDAY) {
    endWall.setUTCDate(endWall.getUTCDate() - 7);
  }

  const startWall = new Date(endWall.getTime());
  startWall.setUTCDate(startWall.getUTCDate() - 7);

  return {
    start: fromWallClock(startWall),
    end: fromWallClock(endWall),
    startWall,
    endWall,
  };
}

/**
 * 判断某时刻是否落在窗口内：[start, end)
 */
export function inWindow(date, window) {
  const t = date.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/**
 * 解析 QFlow 返回的时间字符串（ISO 8601，通常带 +00:00 或 Z）。
 * @returns {Date|null}
 */
export function parseTs(ts) {
  if (!ts || typeof ts !== 'string') return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 挂钟 Date → "2026-10-09" */
export function fmtDate(wall) {
  const y = wall.getUTCFullYear();
  const m = String(wall.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wall.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 挂钟 Date → "2026-10-09（周五）" */
export function fmtDateCn(wall) {
  return `${fmtDate(wall)}（${WEEK_CN[weekdayIndex(wall)]}）`;
}

/** 挂钟 Date → "10-09 14:00" */
export function fmtShort(wall) {
  const m = String(wall.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wall.getUTCDate()).padStart(2, '0');
  const hh = String(wall.getUTCHours()).padStart(2, '0');
  const mm = String(wall.getUTCMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

/**
 * 生成周报文件名：{姓名}-{起月}月{起日}日-{止月}月{止日}日周报.md
 * 例：黄捷-10月9日-10月16日周报.md
 */
export function reportFileName(person, window) {
  const s = window.startWall;
  const e = window.endWall;
  const name = (person || '未登录').trim();
  return `${name}-${s.getUTCMonth() + 1}月${s.getUTCDate()}日-${e.getUTCMonth() + 1}月${e.getUTCDate()}日周报.md`;
}

/**
 * 计算某时间点距今天数（按东八区自然日计）。
 * 用于「卡住 N 天」。
 */
export function daysBetween(fromWall, now = new Date()) {
  const nowWall = toWallClock(now);
  const a = Date.UTC(fromWall.getUTCFullYear(), fromWall.getUTCMonth(), fromWall.getUTCDate());
  const b = Date.UTC(nowWall.getUTCFullYear(), nowWall.getUTCMonth(), nowWall.getUTCDate());
  return Math.round((b - a) / 86400000);
}

/**
 * 把真实时刻转成"东八区挂钟" Date（供 daysBetween 等使用）。
 */
export function toWallClockOf(date) {
  return toWallClock(date);
}

export const _internal = { toWallClock, fromWallClock, weekdayIndex, WEEK_CN };
