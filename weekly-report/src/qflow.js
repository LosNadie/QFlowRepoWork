/**
 * QFlow 取数。
 *
 * 实测结论：
 *   - requirement_user_filter=participated 返回"我参与过的"需求（并集超集）
 *   - 覆盖性验证：窗口内有动作的需求 6/6 全覆盖，缺失 0
 *   - 因此个人周报无需拉全量（243 条），只需 participated（约 19 条），请求量降约 92%
 *
 * 分页：每页固定 50 条。
 */
import { QFLOW_BASE } from './auth.js';

const PAGE_SIZE = 50;
const ACTIVITY_CONCURRENCY = 6;

/** 带令牌的 QFlow 请求 */
async function qflowGet(path, accessToken, { retries = 2 } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'x-q-flow-authorization': `Bearer ${accessToken}`,
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(QFLOW_BASE + path, { headers });
      if (res.status === 401) {
        const e = new Error('登录已过期，请重新登录');
        e.code = 'AUTH_EXPIRED';
        throw e;
      }
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message || `QFlow 错误（code ${json.code}）`);
      return json.data;
    } catch (err) {
      if (err.code === 'AUTH_EXPIRED') throw err;
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * 拉取"我参与过的"需求列表（自动翻页）。
 * @returns {Promise<Array>} 需求数组
 */
export async function fetchParticipated(accessToken, { filter = 'participated', onProgress } = {}) {
  const items = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total) {
    const data = await qflowGet(
      `/api/v1/requirements?page=${page}&requirement_user_filter=${filter}`,
      accessToken
    );
    const batch = data?.items || [];
    items.push(...batch);
    total = data?.pagination?.total ?? items.length;
    if (onProgress) onProgress({ loaded: items.length, total });
    if (batch.length === 0) break;
    page++;
    if (page > 200) break; // 安全上限
  }

  return items.map((it) => ({
    project: it.project?.project_name || '',
    project_id: it.project?.project_id || '',
    requirement_id: it.requirement?.requirement_id || '',
    requirement_num: it.requirement?.requirement_num,
    title: it.requirement?.title || '',
    category: it.requirement?.category || '',
    priority: it.requirement?.priority || '',
    progress_stage: it.requirement?.progress_stage || '',
    progress_updated_at: it.requirement?.progress_updated_at || '',
    current_user: it.current_user?.nickname || '',
  }));
}

/** 拉取单条需求的动态 */
export async function fetchActivities(accessToken, requirementId) {
  const data = await qflowGet(`/api/v1/requirements/${requirementId}/activities`, accessToken);
  return (data?.items || []).map((x) => ({
    remark: x.activity?.action_remark || '',
    at: x.activity?.updated_at || '',
    user: x.user?.nickname || '',
    old: x.activity?.old_stage ?? null,
    new: x.activity?.new_stage ?? null,
  }));
}

/**
 * 并发拉取多条需求的动态，单条失败不中断整体。
 * @returns {Promise<{ok:Array, failed:Array}>}
 */
export async function fetchAllActivities(accessToken, requirements, { onProgress } = {}) {
  const results = new Map();
  const failed = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < requirements.length) {
      const idx = cursor++;
      const r = requirements[idx];
      try {
        results.set(r.requirement_id, await fetchActivities(accessToken, r.requirement_id));
      } catch (err) {
        if (err.code === 'AUTH_EXPIRED') throw err;
        failed.push({ requirement: r, error: err.message });
        results.set(r.requirement_id, []);
      }
      done++;
      if (onProgress) onProgress({ done, total: requirements.length });
    }
  }

  const workers = Array.from(
    { length: Math.min(ACTIVITY_CONCURRENCY, requirements.length) },
    () => worker()
  );
  await Promise.all(workers);

  return {
    ok: requirements.map((r) => ({ ...r, activities: results.get(r.requirement_id) || [] })),
    failed,
  };
}

/** 获取当前登录用户（用于校验令牌有效性） */
export async function fetchMe(accessToken) {
  return qflowGet('/api/v1/auth/me', accessToken);
}

export const _internal = { PAGE_SIZE, ACTIVITY_CONCURRENCY };
