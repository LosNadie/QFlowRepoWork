/**
 * Q助理登录链路。
 *
 * 实测验证过的完整链路（纯浏览器，无需后端）：
 *   1. POST client.qzhuli.com/user/qr_login_create/3        → {scene_id, qr_payload}
 *   2. 轮询 /user/qr_login_status {scene_id}                → {status, login_data}
 *      login_data = {uid, tk, token, cid, nickname, avatar}
 *   3. POST /user/web_sso_ticket（表单 + MD5 签名）           → {ticket}
 *   4. POST qflow/api/v1/qzhuli/auth/ticket {ticket}        → {data:{login_session:{access_token,...}}}
 *
 * 注意：QFlow 返回的令牌字段是 snake_case（access_token），非驼峰。
 */
import { buildParams, encodeForm } from './sign.js';

export const CLIENT_BASE = 'https://client.qzhuli.com';
export const QFLOW_BASE = 'https://qflow.qzhuli.cn';

const QR_POLL_INTERVAL_MS = 5000;

/** 带签名的客户端请求 */
async function clientPost(path, params, auth, { timeoutMs = 20000 } = {}) {
  const body = encodeForm(buildParams(params, auth));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CLIENT_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`响应不是 JSON（HTTP ${res.status}）`); }
    if (json.code !== 200) throw new Error(json.msg || `接口错误（code ${json.code}）`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 创建扫码会话 */
export async function createQrSession() {
  const data = await clientPost('/user/qr_login_create/3', {}, null);
  if (!data?.scene_id) throw new Error('未能创建扫码会话');
  return {
    sceneId: data.scene_id,
    qrPayload: data.qr_payload || JSON.stringify({ scene_id: data.scene_id, api_client_type: 3 }),
    expiresIn: data.expires_in || 300,
  };
}

/** 查询扫码状态 */
export async function pollQrStatus(sceneId) {
  const data = await clientPost('/user/qr_login_status', { scene_id: sceneId }, null);
  return { status: data?.status || 'unknown', loginData: data?.login_data || null };
}

/** 从 login_data 提取登录凭据（对应 qz 的 parseLoginData） */
export function parseLoginData(loginData) {
  if (!loginData || typeof loginData !== 'object') return null;
  const uid = loginData.uid ?? loginData.user_id;
  const tk = typeof loginData.tk === 'string' ? loginData.tk : undefined;
  const token = typeof loginData.token === 'string' ? loginData.token : undefined;
  if (!uid || !tk || !token) return null;
  return {
    uid, tk, token,
    cid: loginData.cid ?? loginData.device_id ?? '',
    nickname: typeof loginData.nickname === 'string' ? loginData.nickname : '',
    avatar: typeof loginData.avatar === 'string' ? loginData.avatar : '',
    authMethod: 'qr_code',
  };
}

/** 用登录态换 SSO 票据 */
export async function fetchSsoTicket(auth) {
  const data = await clientPost('/user/web_sso_ticket', {}, auth);
  const ticket = data?.ticket;
  if (!ticket) throw new Error('未能取得 SSO 票据');
  return ticket;
}

/** 用 SSO 票据换 QFlow 令牌 */
export async function exchangeQflowToken(ticket) {
  const res = await fetch(`${QFLOW_BASE}/api/v1/qzhuli/auth/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || `QFlow 换票失败（code ${json.code}）`);
  const sess = json.data?.login_session;
  if (!sess?.access_token) throw new Error('QFlow 未返回 access_token');
  return {
    accessToken: sess.access_token,          // 注意 snake_case
    refreshToken: sess.refresh_token ?? '',
    expiresIn: sess.expires_in ?? 7200,
    user: sess.user || {},
    teams: sess.teams || [],
  };
}

/** 刷新 QFlow 令牌 */
export async function refreshQflowToken(refreshToken) {
  const res = await fetch(`${QFLOW_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || '刷新令牌失败');
  const sess = json.data?.login_session || json.data;
  if (!sess?.access_token) throw new Error('刷新后未返回 access_token');
  return {
    accessToken: sess.access_token,
    refreshToken: sess.refresh_token ?? refreshToken,
    expiresIn: sess.expires_in ?? 7200,
    user: sess.user || {},
    teams: sess.teams || [],
  };
}

/**
 * 完整的扫码登录流程（含轮询）。
 * @param {object} hooks
 * @param {(s:{sceneId:string, qrPayload:string, secondsLeft:number}) => void} hooks.onQr 拿到二维码时回调
 * @param {(status:string) => void} [hooks.onStatus] 状态变化（pending/scanned/expired/success）
 * @param {AbortSignal} [hooks.signal] 用于取消
 * @returns {Promise<{auth:object, qflow:object}>}
 */
export async function loginWithQr({ onQr, onStatus, signal } = {}) {
  const { sceneId, qrPayload, expiresIn } = await createQrSession();
  if (onQr) onQr({ sceneId, qrPayload, secondsLeft: expiresIn });

  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('已取消登录');
    await new Promise((r) => setTimeout(r, QR_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error('已取消登录');

    const { status, loginData } = await pollQrStatus(sceneId);
    if (onStatus) onStatus(status);

    if (status === 'expired') throw new Error('二维码已过期，请重新获取');

    const parsed = loginData ? parseLoginData(loginData) : null;
    if (parsed) {
      if (onStatus) onStatus('success');
      const ticket = await fetchSsoTicket(parsed);
      const qflow = await exchangeQflowToken(ticket);
      return { auth: parsed, qflow };
    }
  }
  throw new Error('二维码已过期，请重新获取');
}
