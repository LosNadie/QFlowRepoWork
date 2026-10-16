#!/usr/bin/env node
/**
 * 运行全部测试。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  ['vendor', 'vendor.test.mjs'],
  ['week', 'week.test.mjs'],
  ['sign', 'sign.test.mjs'],
  ['classify', 'classify.test.mjs'],
  ['report', 'report.test.mjs'],
  ['qflow (在线)', 'qflow.test.mjs'],
  ['flow (在线)', 'flow.test.mjs'],
  ['e2e (在线)', 'e2e.test.mjs'],
];

let failed = 0;
const results = [];

for (const [name, file] of suites) {
  process.stdout.write(`\n${'─'.repeat(58)}\n▶ ${name}\n${'─'.repeat(58)}\n`);
  const r = spawnSync(process.execPath, [path.join(HERE, file)], { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  results.push({ name, ok });
}

console.log(`\n${'═'.repeat(58)}`);
console.log('测试汇总');
console.log('═'.repeat(58));
for (const { name, ok } of results) {
  console.log(`  ${ok ? '✅' : '❌'}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} 套件通过`);
process.exit(failed === 0 ? 0 : 1);
