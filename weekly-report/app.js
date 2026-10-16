/**
 * 周报生成器 · 界面编排。
 *
 * 流程：扫码登录 → 取本周工作 → 生成周报 → 写入所选目录
 */
import { loginWithQr } from './src/auth.js';
import { fetchParticipated, fetchAllActivities } from './src/qflow.js';
import { classify } from './src/classify.js';
import { weekWindow, reportFileName, fmtDateCn } from './src/week.js';
import { buildReport } from './src/report.js';
import {
  isSupported, restoreRoot, pickRoot, clearRoot,
  listSubdirs, writeTextFile, fileExists, downloadFile,
  isBlockedFolderError, isUserCancel,
} from './src/picker.js';
import qrcode from './vendor/qrcode.esm.js';

// ---------- 元素 ----------
const $ = (id) => document.getElementById(id);

const el = {
  loginBadge: $('login-badge'), loginBody: $('login-body'), loginDone: $('login-done'),
  qrCanvas: $('qr-canvas'), qrOverlay: $('qr-overlay'), qrStatus: $('qr-status'),
  btnRefreshQr: $('btn-refresh-qr'), btnLogout: $('btn-logout'),
  userAvatar: $('user-avatar'), userName: $('user-name'), userSub: $('user-sub'),

  cardFetch: $('card-fetch'), fetchBadge: $('fetch-badge'), fetchStatus: $('fetch-status'),
  winText: $('win-text'), btnWinToggle: $('btn-win-toggle'), winEdit: $('win-edit'),
  winStart: $('win-start'), winEnd: $('win-end'),
  btnWinApply: $('btn-win-apply'), btnWinReset: $('btn-win-reset'),
  btnFetch: $('btn-fetch'), reqList: $('req-list'),

  cardSave: $('card-save'), saveBadge: $('save-badge'), saveStatus: $('save-status'),
  fnameInput: $('fname-input'), dirPath: $('dir-path'),
  btnPickRoot: $('btn-pick-root'), btnClearDir: $('btn-clear-dir'),
  browser: $('browser'), btnUp: $('btn-up'), crumbs: $('crumbs'),
  btnChooseHere: $('btn-choose-here'), browserList: $('browser-list'),
  btnGenerate: $('btn-generate'), btnSave: $('btn-save'), btnDownload: $('btn-download'),
  previewWrap: $('preview-wrap'), preview: $('preview'),
  log: $('log'),
};

// ---------- 状态 ----------
const state = {
  auth: null,          // 客户端登录态
  qflow: null,         // QFlow 令牌
  person: '',
  window: weekWindow(),
  windowCustom: false,
  requirements: [],    // 含 activities 与 ban
  selected: new Set(), // 勾选的需求 id
  report: '',
  filename: '',
  rootHandle: null,
  pathSegments: [],    // 相对根目录的路径
  curHandle: null,
  busy: false,
};

// ---------- 工具 ----------
function log(msg) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.log.textContent += `[${t}] ${msg}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}

function setStatus(node, msg, kind = '') {
  node.textContent = msg;
  node.className = 'status' + (kind ? ' ' + kind : '');
}

function setBadge(node, text, kind = '') {
  node.textContent = text;
  node.className = 'badge' + (kind ? ' ' + kind : '');
}

function setBusy(on, label = '') {
  state.busy = on;
  document.body.style.cursor = on ? 'progress' : '';
  if (on && label) log(label);
}

/** datetime-local 值 ↔ Date */
function toLocalInput(date) {
  const w = new Date(date.getTime() + 8 * 3600 * 1000); // 按东八区展示
  const p = (n) => String(n).padStart(2, '0');
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}T${p(w.getUTCHours())}:${p(w.getUTCMinutes())}`;
}
function fromLocalInput(value) {
  // 输入按东八区解释
  const [d, t] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = (t || '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi) - 8 * 3600 * 1000);
}

function renderWindowText() {
  const w = state.window;
  el.winText.textContent =
    `${fmtDateCn(w.startWall)} 14:00 ~ ${fmtDateCn(w.endWall)} 14:00`;
}

// ---------- 二维码 ----------
function renderQr(payload) {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();

  // 按容器可用尺寸计算格子大小，避免裁切
  const target = 190;               // 容器内可用边长（留边距）
  const margin = 2;                 // 静区（模块数）
  const cell = Math.max(2, Math.floor(target / (count + margin * 2)));
  const size = (count + margin * 2) * cell;

  const canvas = el.qrCanvas;
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
  }
}

// ---------- 步骤 1：登录 ----------
let loginAbort = null;

async function startLogin() {
  if (loginAbort) loginAbort.abort();
  loginAbort = new AbortController();
  el.qrOverlay.hidden = true;
  el.btnRefreshQr.hidden = true;
  setBadge(el.loginBadge, '等待扫码', 'warn');
  setStatus(el.qrStatus, '正在获取二维码…');
  setBusy(true, '开始扫码登录');

  try {
    const { auth, qflow } = await loginWithQr({
      signal: loginAbort.signal,
      onQr: ({ qrPayload, secondsLeft }) => {
        renderQr(qrPayload);
        setStatus(el.qrStatus, `请用 Q助理 App 扫码（${secondsLeft} 秒内有效）`);
        log('二维码已生成');
      },
      onStatus: (s) => {
        if (s === 'pending') return;
        if (s === 'success') setStatus(el.qrStatus, '登录成功，正在换取 QFlow 令牌…', 'ok');
        else setStatus(el.qrStatus, `状态：${s}`);
      },
    });

    state.auth = auth;
    state.qflow = qflow;
    state.person = qflow.user?.nickname || auth.nickname || '未登录';
    log(`登录成功：${state.person}`);

    el.loginBody.hidden = true;
    el.loginDone.hidden = false;
    el.userName.textContent = state.person;
    el.userSub.textContent = `QFlow 令牌有效期 ${Math.round((qflow.expiresIn || 7200) / 60)} 分钟`;
    if (qflow.user?.avatar || auth.avatar) el.userAvatar.src = qflow.user?.avatar || auth.avatar;
    setBadge(el.loginBadge, '已登录', 'ok');

    enableStep2();
    // 默认文件名
    state.filename = reportFileName(state.person, state.window);
    el.fnameInput.value = state.filename;
  } catch (err) {
    if (err.message === '已取消登录') return;
    log('登录失败：' + err.message);
    setBadge(el.loginBadge, '登录失败', 'err');
    setStatus(el.qrStatus, err.message, 'err');
    el.qrOverlay.hidden = false;
    el.qrOverlay.textContent = '二维码已失效';
    el.btnRefreshQr.hidden = false;
  } finally {
    setBusy(false);
  }
}

function enableStep2() {
  el.cardFetch.classList.remove('disabled');
  el.btnFetch.disabled = false;
  renderWindowText();
  el.winStart.value = toLocalInput(state.window.start);
  el.winEnd.value = toLocalInput(state.window.end);
}

// ---------- 步骤 2：取数 ----------
async function doFetch() {
  if (!state.qflow) return;
  setBusy(true, '开始获取本周工作内容');
  el.btnFetch.disabled = true;
  setBadge(el.fetchBadge, '获取中', 'warn');
  setStatus(el.fetchStatus, '正在拉取需求列表…');

  try {
    const reqs = await fetchParticipated(state.qflow.accessToken, {
      onProgress: ({ loaded, total }) => {
        setStatus(el.fetchStatus, `需求列表 ${loaded}/${total}…`);
      },
    });
    log(`participated 需求 ${reqs.length} 条`);

    setStatus(el.fetchStatus, `正在拉取 ${reqs.length} 条需求的动态…`);
    const { ok, failed } = await fetchAllActivities(state.qflow.accessToken, reqs, {
      onProgress: ({ done, total }) => setStatus(el.fetchStatus, `动态 ${done}/${total}…`),
    });
    log(`动态拉取完成，失败 ${failed.length} 条`);

    for (const r of ok) r.ban = classify(r.project, r.title, r.requirement_num);

    // 保留全部 participated 需求：
    //   「本周情况」由 buildReport 按窗口过滤；
    //   「当前积压」需要全集（当前负责人是我、但本周无动作的需求也要算）。
    // 仅筛掉「窗口内无我动作、且当前负责人也不是我」的无关项，减少噪音。
    const relevant = ok.filter((r) =>
      r.current_user === state.person ||
      (r.activities || []).some((a) => {
        if (a.user !== state.person || !a.at) return false;
        const t = new Date(a.at);
        return !Number.isNaN(t.getTime()) &&
          t.getTime() >= state.window.start.getTime() &&
          t.getTime() < state.window.end.getTime();
      })
    );

    state.requirements = relevant;
    state.selected = new Set(relevant.map((r) => r.requirement_id));

    const winCount = relevant.filter((r) =>
      (r.activities || []).some((a) => {
        if (a.user !== state.person || !a.at) return false;
        const t = new Date(a.at);
        return !Number.isNaN(t.getTime()) &&
          t.getTime() >= state.window.start.getTime() &&
          t.getTime() < state.window.end.getTime();
      })
    ).length;

    log(`取回 ${relevant.length} 条相关需求，其中 ${winCount} 条本周有我的动作`);
    setStatus(el.fetchStatus,
      `本周有 ${winCount} 条需求有进展${failed.length ? `（${failed.length} 条动态获取失败）` : ''}`, 'ok');
    setBadge(el.fetchBadge, `${winCount} 条`, winCount ? 'ok' : 'warn');

    renderReqList();
    enableStep3();
  } catch (err) {
    log('取数失败：' + err.message);
    setStatus(el.fetchStatus, err.message, 'err');
    setBadge(el.fetchBadge, '失败', 'err');
    if (err.code === 'AUTH_EXPIRED') handleAuthExpired();
  } finally {
    el.btnFetch.disabled = false;
    setBusy(false);
  }
}

function renderReqList() {
  el.reqList.hidden = false;
  el.reqList.innerHTML = '';

  if (!state.requirements.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '本周没有你参与的动态。仍可生成周报（会显示「本周无需求进展」）。';
    el.reqList.appendChild(p);
    return;
  }

  for (const r of state.requirements) {
    const mine = (r.activities || []).filter((a) => a.user === state.person).length;
    const item = document.createElement('label');
    item.className = 'req-item';
    item.innerHTML = `
      <input type="checkbox" ${state.selected.has(r.requirement_id) ? 'checked' : ''}>
      <span>
        <span class="req-title">NO.${r.requirement_num} ${escapeHtml(r.title)}</span>
        <span class="req-meta"> · ${escapeHtml(r.project)} · ${escapeHtml(r.ban)} · ${r.progress_stage} · 我的动作 ${mine} 条</span>
      </span>`;
    const cb = item.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(r.requirement_id);
      else state.selected.delete(r.requirement_id);
      el.btnGenerate.disabled = false;
      el.btnSave.disabled = true;
    });
    el.reqList.appendChild(item);
  }
}

function enableStep3() {
  el.cardSave.classList.remove('disabled');
  el.btnGenerate.disabled = false;
  if (!state.filename) {
    state.filename = reportFileName(state.person, state.window);
    el.fnameInput.value = state.filename;
  }
  if (!isSupported()) {
    setStatus(el.saveStatus, '当前浏览器不支持目录选择（需 Chrome / Edge），将使用下载方式保存。', 'err');
    el.btnDownload.hidden = false;
    el.btnPickRoot.hidden = true;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 步骤 3：生成 ----------
function doGenerate() {
  const chosen = state.requirements.filter((r) => state.selected.has(r.requirement_id));
  state.report = buildReport({
    person: state.person,
    window: state.window,
    requirements: chosen,
  });
  state.filename = el.fnameInput.value.trim() || reportFileName(state.person, state.window);

  el.previewWrap.hidden = false;
  el.preview.textContent = state.report;
  el.btnSave.disabled = false;
  // 不支持目录 API 时，下载按钮必须可见
  if (!isSupported()) el.btnDownload.hidden = false;

  const lines = state.report.split('\n').length;
  setStatus(el.saveStatus, `已生成（${chosen.length} 条需求，${lines} 行）。可预览后保存。`, 'ok');
  setBadge(el.saveBadge, '已生成', 'ok');
  log(`周报已生成：${chosen.length} 条需求 / ${lines} 行`);
}

// ---------- 目录选择 ----------
async function initDir() {
  if (!isSupported()) return;
  try {
    const root = await restoreRoot();
    if (root) {
      state.rootHandle = root;
      state.pathSegments = [];
      state.curHandle = root;
      await refreshBrowser();
      el.btnClearDir.hidden = false;
      log('已恢复上次的目录授权');
    }
  } catch (err) {
    log('恢复目录授权失败：' + err.message);
  }
}

async function chooseRoot() {
  try {
    const root = await pickRoot();
    state.rootHandle = root;
    state.pathSegments = [];
    state.curHandle = root;
    el.btnClearDir.hidden = false;
    await refreshBrowser();
    log('已选择目录：' + root.name + '（可在页内逐层进入子目录）');
  } catch (err) {
    if (isUserCancel(err)) return;
    if (isBlockedFolderError(err)) {
      setStatus(el.saveStatus,
        'Chrome 不允许选择磁盘根目录或系统文件夹。请先在资源管理器里建好一个子文件夹（如 D:\\周报），' +
        '在弹窗中双击进入该文件夹后再点「选择文件夹」。', 'err');
      log('目录被 Chrome 拦截（根目录/系统文件夹不受支持）');
      return;
    }
    setStatus(el.saveStatus, '目录选择失败：' + err.message, 'err');
    log('目录选择失败：' + err.message);
  }
}

async function refreshBrowser() {
  el.browser.hidden = false;
  el.crumbs.textContent = '/' + state.pathSegments.join('/');
  el.btnUp.disabled = state.pathSegments.length === 0;
  el.dirPath.textContent = (state.rootHandle?.name || '') +
    (state.pathSegments.length ? '/' + state.pathSegments.join('/') : '');

  el.browserList.innerHTML = '';
  try {
    const subs = await listSubdirs(state.curHandle);
    if (!subs.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '（此目录下没有子目录，可直接选用此目录）';
      el.browserList.appendChild(li);
      return;
    }
    for (const { name, handle } of subs) {
      const li = document.createElement('li');
      li.textContent = '📁 ' + name;
      li.addEventListener('click', async () => {
        state.curHandle = handle;
        state.pathSegments.push(name);
        await refreshBrowser();
      });
      el.browserList.appendChild(li);
    }
  } catch (err) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '读取目录失败：' + err.message;
    el.browserList.appendChild(li);
  }
}

async function goUp() {
  if (!state.pathSegments.length) return;
  state.pathSegments.pop();
  state.curHandle = await resolveSegments();
  await refreshBrowser();
}

async function resolveSegments() {
  let cur = state.rootHandle;
  for (const seg of state.pathSegments) cur = await cur.getDirectoryHandle(seg);
  return cur;
}

// ---------- 保存 ----------
async function doSave() {
  if (!state.report) return;
  setBusy(true, '开始保存周报');

  try {
    if (isSupported() && state.curHandle) {
      const exists = await fileExists(state.curHandle, state.filename);
      if (exists && !confirm(`「${state.filename}」已存在，是否覆盖？`)) {
        setBusy(false);
        return;
      }
      await writeTextFile(state.curHandle, state.filename, state.report);
      const where = (state.rootHandle?.name || '') +
        (state.pathSegments.length ? '/' + state.pathSegments.join('/') : '');
      setStatus(el.saveStatus, `已保存到 ${where}/${state.filename}`, 'ok');
      setBadge(el.saveBadge, '已保存', 'ok');
      log(`已写入：${where}/${state.filename}`);
    } else {
      downloadFile(state.filename, state.report);
      setStatus(el.saveStatus, `已下载 ${state.filename}`, 'ok');
      setBadge(el.saveBadge, '已下载', 'ok');
      log('已触发下载');
    }
  } catch (err) {
    setStatus(el.saveStatus, '保存失败：' + err.message, 'err');
    log('保存失败：' + err.message);
  } finally {
    setBusy(false);
  }
}

function handleAuthExpired() {
  state.qflow = null;
  el.loginDone.hidden = true;
  el.loginBody.hidden = false;
  setBadge(el.loginBadge, '需重新登录', 'err');
  el.cardFetch.classList.add('disabled');
  el.cardSave.classList.add('disabled');
  el.btnFetch.disabled = true;
  startLogin();
}

// ---------- 事件绑定 ----------
el.btnRefreshQr.addEventListener('click', startLogin);

el.btnLogout.addEventListener('click', () => {
  if (loginAbort) loginAbort.abort();
  state.auth = null; state.qflow = null; state.person = '';
  state.requirements = []; state.selected.clear(); state.report = '';
  el.loginDone.hidden = true;
  el.loginBody.hidden = false;
  el.cardFetch.classList.add('disabled');
  el.cardSave.classList.add('disabled');
  el.btnFetch.disabled = true;
  el.reqList.hidden = true;
  el.previewWrap.hidden = true;
  el.btnSave.disabled = true;
  setBadge(el.loginBadge, '未登录');
  setBadge(el.fetchBadge, '—');
  setBadge(el.saveBadge, '—');
  setStatus(el.qrStatus, '');
  log('已退出登录');
  startLogin();
});

el.btnWinToggle.addEventListener('click', () => {
  el.winEdit.hidden = !el.winEdit.hidden;
});

el.btnWinApply.addEventListener('click', () => {
  try {
    const s = fromLocalInput(el.winStart.value);
    const e = fromLocalInput(el.winEnd.value);
    if (!(s < e)) throw new Error('起始时间必须早于结束时间');
    state.window = {
      start: s, end: e,
      startWall: new Date(s.getTime() + 8 * 3600 * 1000),
      endWall: new Date(e.getTime() + 8 * 3600 * 1000),
    };
    state.windowCustom = true;
    renderWindowText();
    el.winEdit.hidden = true;
    state.filename = reportFileName(state.person, state.window);
    el.fnameInput.value = state.filename;
    log('已应用自定义时间窗口');
  } catch (err) {
    alert(err.message);
  }
});

el.btnWinReset.addEventListener('click', () => {
  state.window = weekWindow();
  state.windowCustom = false;
  renderWindowText();
  el.winStart.value = toLocalInput(state.window.start);
  el.winEnd.value = toLocalInput(state.window.end);
  el.winEdit.hidden = true;
  state.filename = reportFileName(state.person, state.window);
  el.fnameInput.value = state.filename;
  log('已恢复默认时间窗口');
});

el.btnFetch.addEventListener('click', doFetch);
el.btnGenerate.addEventListener('click', doGenerate);
el.btnSave.addEventListener('click', doSave);
el.btnDownload.addEventListener('click', () => {
  if (state.report) downloadFile(state.filename || '周报.md', state.report);
});
el.btnPickRoot.addEventListener('click', chooseRoot);
el.btnClearDir.addEventListener('click', async () => {
  await clearRoot();
  state.rootHandle = null; state.curHandle = null; state.pathSegments = [];
  el.browser.hidden = true;
  el.dirPath.textContent = '未选择';
  el.btnClearDir.hidden = true;
  log('已清除目录授权');
});
el.btnUp.addEventListener('click', goUp);
el.btnChooseHere.addEventListener('click', async () => {
  state.curHandle = await resolveSegments();
  const where = (state.rootHandle?.name || '') +
    (state.pathSegments.length ? '/' + state.pathSegments.join('/') : '');
  el.dirPath.textContent = where;
  setStatus(el.saveStatus, `将保存到 ${where}/`, 'ok');
  log(`选用目录：${where}`);
});

// ---------- 启动 ----------
renderWindowText();
log('页面已就绪');
if (!isSupported()) {
  log('提示：当前浏览器不支持目录选择 API，将使用下载方式保存');
}
initDir();
startLogin();
