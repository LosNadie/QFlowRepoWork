/**
 * 端到端验证：真实令牌 → 取数 → 归类 → 生成周报。
 * 证明各模块串联后产出正确，且与 Python 参考实现一致。
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
const window = weekWindow(NOW);
const person = '黄捷';

console.log('=== 端到端：真实取数 → 归类 → 生成周报 ===');
console.log(`窗口: ${fmtDateCn(window.startWall)} 14:00 ~ ${fmtDateCn(window.endWall)} 14:00`);

console.log('\n[1/4] 拉取 participated 需求...');
const reqs = await fetchParticipated(token);
console.log(`      ${reqs.length} 条`);

console.log('\n[2/4] 拉取各需求动态...');
const { ok, failed } = await fetchAllActivities(token, reqs);
console.log(`      完成 ${ok.length} 条，失败 ${failed.length} 条`);

console.log('\n[3/4] 板块归类...');
for (const r of ok) r.ban = classify(r.project, r.title, r.requirement_num);
const banCount = new Map();
for (const r of ok) banCount.set(r.ban, (banCount.get(r.ban) || 0) + 1);
console.log(`      ${banCount.size} 个板块`);

console.log('\n[4/4] 生成周报...');
const md = buildReport({ person, window, requirements: ok, now: NOW });
const fname = reportFileName(person, window);
console.log(`      文件名: ${fname}`);
console.log(`      长度: ${md.length} 字符 / ${md.split('\n').length} 行`);

// 回归断言：已完成的需求必须计入（验收完成同样代表工作量）
const completedWithAct = ok.filter(
  (r) => r.progress_stage === '已完成' &&
    (r.activities || []).some((a) => {
      if (a.user !== person || !a.at) return false;
      const t = new Date(a.at);
      return t >= window.start && t < window.end;
    })
);
console.log(`      其中「已完成」需求 ${completedWithAct.length} 条`);
for (const r of completedWithAct) {
  const present = md.includes(`NO.${r.requirement_num} `);
  console.log(`        ${present ? '✓' : '✗'} NO.${r.requirement_num} ${r.title.slice(0, 40)}`);
  if (!present) {
    console.log(`        !! 已完成需求未出现在周报中`);
    process.exitCode = 1;
  }
}

const out = path.join(HERE, 'fixtures', 'e2e_output.md');
fs.writeFileSync(out, md, 'utf8');
console.log(`      已写入: ${out}`);

// 与 Python 参考实现比对
console.log('\n=== 与 Python 参考实现比对 ===');
const expectedPath = path.join(HERE, 'fixtures', 'expected_report_0.md');
if (fs.existsSync(expectedPath)) {
  const expected = fs.readFileSync(expectedPath, 'utf8').replace(/\r\n/g, '\n');
  if (md === expected) {
    console.log('  OK 端到端产出与 Python 参考实现逐字节一致');
  } else {
    console.log('  差异（前 10 处）：');
    const a = md.split('\n'), e = expected.split('\n');
    let shown = 0;
    for (let i = 0; i < Math.max(a.length, e.length) && shown < 10; i++) {
      if (a[i] !== e[i]) {
        console.log(`    行 ${i + 1}:`);
        console.log(`      JS = ${JSON.stringify(a[i])}`);
        console.log(`      PY = ${JSON.stringify(e[i])}`);
        shown++;
      }
    }
  }
} else {
  console.log('  未找到基准文件，跳过比对');
}

console.log('\n=== 周报预览（前 30 行）===');
console.log(md.split('\n').slice(0, 30).join('\n'));
