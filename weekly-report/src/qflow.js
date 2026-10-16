/**
 * QFlow 取数。
 *
 * 实测结论（2026-10-16 验证）：
 *
 * 1) `requirement_user_filter=participated` 单独使用时**只返回"进行中"的需求**，
 *    全部「已完成」需求被排除。实测：单用该过滤只有 19 条，
 *    而按阶段逐个拉取合计 87 条（含已完成 55 条、已取消 13 条）。
 *
 * 2) `requirement_user_filter` 与 `progress_stage` **可以叠加**，
 *    因此正确做法是「按阶段逐个拉取」，确保已完成的工作不被丢失。
 *    验收完成同样代表工作量，必须计入周报。
 *
 * 3) 分页：每页固定 50 条。
 */
import { QFLOW_BASE } from './auth.js';

const PAGE_SIZE = 50;
const ACTIVITY_CONCURRENCY = 6;

/** 需要拉取的需求阶段（覆盖全部生命周期，避免漏掉已完成的工作） */
export const STAGES = [
  '待领取', '待审批', '待完善', '完善中', '研发中',
  '待验收', '验收中', '已完成', '已关闭', '已取消',
];

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

/** 规范化一条需求 */
function normalize(it) {
  return {
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
  };
}

/**
 * 拉取某阶段下"我参与过的"需求（自动翻页）。
 */
async function fetchStage(accessToken, stage, filter) {
  const out = [];
  let page = 1;
  let total = Infinity;

  while (out.length < total) {
    const q =
      `/api/v1/requirements?page=${page}` +
      `&requirement_user_filter=${encodeURIComponent(filter)}` +
      `&progress_stage=${encodeURIComponent(stage)}`;
    const data = await qflowGet(q, accessToken);
    const batch = data?.items || [];
    out.push(...batch);
    total = data?.pagination?.total ?? out.length;
    if (batch.length === 0) break;
    page++;
    if (page > 200) break; // 安全上限
  }
  return out;
}

/**
 * 拉取"我参与过的"全部需求（覆盖所有阶段，含已完成）。
 *
 * 注意：不能只用 requirement_user_filter=participated，
 * 那样会漏掉全部「已完成」需求（实测漏 68 条）。
 *
 * @param {string} accessToken
 * @param {object} [opts]
 * @param {string} [opts.filter='participated']
 * @param {string[]} [opts.stages=STAGES]
 * @param {(p:{stage:string, loaded:number, total:number, stagesDone:number, stagesTotal:number}) => void} [opts.onProgress]
 * @returns {Promise<Array>} 去重后的需求数组
 */
export async function fetchParticipated(accessToken, opts = {}) {
  const { filter = 'participated', stages = STAGES, onProgress } = opts;
  const byId = new Map();

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    let items = [];
    try {
      items = await fetchStage(accessToken, stage, filter);
    } catch (err) {
      if (err.code === 'AUTH_EXPIRED') throw err;
      // 单个阶段失败不中断整体
      if (onProgress) {
        onProgress({ stage, loaded: 0, total: 0, stagesDone: i + 1, stagesTotal: stages.length, error: err.message });
      }
      continue;
    }
    for (const it of items) {
      const r = normalize(it);
      if (r.requirement_id) byId.set(r.requirement_id, r);
    }
    if (onProgress) {
      onProgress({
        stage,
        loaded: items.length,
        total: items.length,
        stagesDone: i + 1,
        stagesTotal: stages.length,
      });
    }
  }

  return [...byId.values()];
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
