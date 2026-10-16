/**
 * 目录选择与写盘。
 *
 * 浏览器安全模型不允许网页枚举盘符或遍历整个文件系统。
 * 因此采用两步法，在合规前提下实现"页内逐层浏览"：
 *   1. showDirectoryPicker() 让用户授权一个根目录
 *   2. 授权后在页面内列出子目录、逐层进入
 *   3. 授权句柄存入 IndexedDB，后续自动复用
 *
 * 非 Chromium 浏览器（Firefox/Safari）无此 API，降级为下载文件。
 */

const DB_NAME = 'weekly-report';
const STORE = 'handles';
const KEY = 'root-dir';

/** 是否支持目录选择器 */
export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// ---------- IndexedDB 持久化目录句柄 ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取已保存的根目录句柄，并校验权限是否仍然有效 */
export async function restoreRoot() {
  if (!isSupported()) return null;
  try {
    const handle = await idbGet(KEY);
    if (!handle) return null;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;
    const req = await handle.requestPermission({ mode: 'readwrite' });
    return req === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

/** 让用户选择一个根目录 */
export async function pickRoot() {
  if (!isSupported()) throw new Error('当前浏览器不支持目录选择，请使用 Chrome 或 Edge');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'weekly-report-root' });
  await idbSet(KEY, handle);
  return handle;
}

/** 清除已保存的目录授权 */
export async function clearRoot() {
  try { await idbDel(KEY); } catch { /* ignore */ }
}

// ---------- 页内目录浏览 ----------

/** 列出某目录下的子目录（按名称排序）。 */
export async function listSubdirs(dirHandle) {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') out.push({ name, handle });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return out;
}

// ---------- 写盘 ----------

/**
 * 写入文本文件。同名文件直接覆盖（与脚本的幂等行为一致）。
 * @param {FileSystemDirectoryHandle} dirHandle 目标目录
 * @param {string} filename 文件名
 * @param {string} text 内容
 */
export async function writeTextFile(dirHandle, filename, text) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
  return fileHandle;
}

/** 检查目录下是否已存在同名文件 */
export async function fileExists(dirHandle, filename) {
  try {
    await dirHandle.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * 降级方案：通过浏览器下载保存文件。
 */
export function downloadFile(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
