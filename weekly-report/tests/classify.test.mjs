/**
 * classify.js 测试：与 Python 原版 classify.py 在 243 条真实需求上逐条比对。
 * 基准由 tests/fixtures/gen_expected.py 生成（直接复用原版规则）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, stripPrefix } from '../src/classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/all_requirements.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/expected_ban.json'), 'utf8'));

let pass = 0, fail = 0;

console.log(`=== 与 Python classify.py 逐条比对（${items.length} 条真实需求）===`);
const mismatches = [];
for (const it of items) {
  const got = classify(it.project, it.title, it.requirement_num);
  const want = expected[it.requirement_id];
  if (got === want) pass++;
  else {
    fail++;
    mismatches.push({ it, got, want });
  }
}

if (mismatches.length === 0) {
  console.log(`  OK 全部一致：${pass}/${items.length}`);
} else {
  console.log(`  不一致 ${mismatches.length} 条：`);
  for (const m of mismatches.slice(0, 20)) {
    console.log(`    ${m.it.project} NO.${m.it.requirement_num}`);
    console.log(`      标题: ${m.it.title}`);
    console.log(`      JS  =${m.got}   PY=${m.want}`);
  }
}

console.log('\n=== stripPrefix ===');
function eq(a, b, label) {
  if (a === b) pass++;
  else { fail++; console.log(`  FAIL ${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
}
eq(stripPrefix('【新功能】NAS同步'), 'NAS同步', '去前缀');
eq(stripPrefix('【新功能】Q助理文档'), 'Q助理文档', '去前缀2');
eq(stripPrefix('普通标题'), '普通标题', '无前缀');
eq(stripPrefix(''), '', '空串');
eq(stripPrefix(null), '', 'null');
eq(stripPrefix('  【BUG】 有空格  '), '有空格', '空格处理');

console.log('\n=== 未知项目兜底 ===');
eq(classify('不存在的项目', '任意标题', 1), '通用/未分类', '未知项目');

console.log('\n=== PATCH 精确覆盖优先于关键词 ===');
// NO.602 标题含"私人助理"，但 PATCH 指定为"数字员工"
eq(classify('Q助理', '私人助理新增AI主动工作能力：每日前瞻', 602), '数字员工', 'PATCH 优先');
// 同一标题、不同编号 → 走关键词规则
const noPatch = classify('Q助理', '私人助理新增AI主动工作能力：每日前瞻', 99999);
console.log(`  同标题非 PATCH 编号 99999 → ${noPatch}（走关键词规则）`);

console.log('\n=== 规则顺序敏感性 ===');
// Q助理 NO.543 标题含"终端"等，PATCH 指定"数字员工"
eq(classify('Q助理', 'Q助理CLI支持创建任务', 543), '数字员工', 'PATCH 543');

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
