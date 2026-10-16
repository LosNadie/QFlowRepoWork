// 验证 vendor ESM 包装可用
import md5 from '../vendor/md5.esm.js';
import qrcode from '../vendor/qrcode.esm.js';
import nodeCrypto from 'node:crypto';

const nodeMd5 = (s) => nodeCrypto.createHash('md5').update(s).digest('hex');
const vectors = ['', 'abc', '中文测试', 'a'.repeat(1000), 'r=x&uid=1&tk=2'];
let ok = true;
for (const v of vectors) {
  if (md5(v) !== nodeMd5(v)) { ok = false; console.log('MD5 FAIL:', JSON.stringify(v.slice(0, 20))); }
}
console.log(ok ? 'md5.esm.js OK（与 Node 一致）' : 'md5.esm.js FAIL');

// qrcode 冒烟测试
try {
  const qr = qrcode(0, 'M');
  qr.addData('{"scene_id":"test","api_client_type":3}');
  qr.make();
  const n = qr.getModuleCount();
  console.log(`qrcode.esm.js OK（生成 ${n}x${n} 矩阵）`);
} catch (e) {
  console.log('qrcode.esm.js FAIL:', e.message);
}
