# 周报生成器（网站版）设计文档

- 日期：2026-10-16
- 状态：已批准，实施中
- 修订：第 3 版。第 1 版（自研网页）→ 第 2 版（复用现有脚本）→ **本版（网站，复用现有系统的口径与规则）**

---

## 一、目标

做一个**静态网站**，用户用 Q助理扫码登录后，一键获取 QFlow 本周工作内容，生成周报并存入本地指定目录。

### 1.1 三条核心需求

1. 用 Q助理登录
2. 获取 QFlow 本周工作内容
3. 一键生成周报，存入本地相应位置

### 1.2 已确认决策

| 项 | 决策 |
|---|---|
| 形态 | **静态网站**（可部署，供 Q助理用户使用） |
| 架构 | **纯前端，无后端**（CORS 与签名链路均已实测通过） |
| 周窗口 | **上周五 14:00 ~ 本周五 14:00**（沿用公司既有口径） |
| 板块归类 | **移植现有 `classify.py` 规则到 JS** |
| 报告风格 | 模板化，**不调 AI** |
| 条目形式 | 表格（与公司现有周报一致） |
| 「学习」章节 | **不要** |
| 输出目录 | 页内目录浏览器选择，写入所选目录 |
| 文件名 | `{登录用户姓名}-{起月}月{起日}日-{止月}月{止日}日周报.md` |
| 使用范围 | 内部自用 |

---

## 二、可行性验证（全部已实测，非推测）

这是本设计能成立的基础。所有验证均在本机实际执行。

| # | 验证项 | 结果 |
|---|---|---|
| 1 | `client.qzhuli.com` 扫码接口 CORS | ✅ `Access-Control-Allow-Origin: *` |
| 2 | `client.qzhuli.com` 签名接口 CORS（含预检） | ✅ `*` |
| 3 | `qflow.qzhuli.cn` 预检 | ✅ 回显 Origin，允许 `authorization, x-q-flow-authorization` |
| 4 | 二维码 payload 结构 | ✅ `{"scene_id":"...","api_client_type":3}` |
| 5 | 签名算法（从 `qz` v0.5.8 反解） | ✅ 与 `qz` 一致 |
| 6 | **浏览器可用 MD5（blueimp-md5）** | ✅ 与 Node 逐字符一致（含中文、长串、空串） |
| 7 | **纯浏览器全链路** | ✅ **签名 → SSO → QFlow 令牌 → 取数，无后端** |
| 8 | QFlow 令牌字段名 | ⚠️ **snake_case**：`access_token` / `refresh_token`，非驼峰 |
| 9 | `requirement_user_filter=participated` | ✅ 19 条，覆盖验证 6/6，零缺失 |

### 2.1 覆盖性验证方法（关键）

先按 `progress_updated_at >= 窗口起点` 筛出窗口内更新过的需求（65 条），逐个拉 `activities`，找出登录用户在窗口内有动作的需求，再检查是否全部落在 `participated` 集合内。

**结果**：窗口内有动作 6 条，`participated` 覆盖 **6/6，缺失 0**。

**结论**：只需拉 `participated`（19 条），无需拉全量（243 条），请求量降低约 **92%**。

---

## 三、架构

```
静态网页（HTML + 原生 ES Module + CSS，无框架、无构建）
   │
   ├─ 1. 扫码登录 ── POST client.qzhuli.com/user/qr_login_create/3
   │                 轮询 /user/qr_login_status → login_data{uid,tk,token,cid}
   ├─ 2. 换 SSO 票据 ─ POST /user/web_sso_ticket（表单 + MD5 签名）
   ├─ 3. 换 QFlow 令牌 POST qflow.qzhuli.cn/api/v1/qzhuli/auth/ticket
   ├─ 4. 取本周工作 ─── GET /api/v1/requirements?page=N&requirement_user_filter=participated
   │                    GET /api/v1/requirements/{id}/activities
   ├─ 5. 板块归类 ───── 移植 classify.py 规则
   ├─ 6. 生成 Markdown ─ 纯函数
   └─ 7. 存本地 ─────── showDirectoryPicker → 页内目录浏览器 → 写入 .md
```

### 3.1 接口与算法细节

**签名（`client.qzhuli.com` 侧，表单编码）**

```js
// 1) 构造参数
params.r = 16 字节随机 hex
params.uid = uid            // 需鉴权时
params.tk  = tk             // 需鉴权时
// 合并业务参数（空字符串跳过，非字符串 String()）
// 2) 计算签名（key 与 base 不参与）
sorted = 各键值对按 key 字典序 → "k=v"
if (token) sorted.push("token=" + token)
params.key = MD5(sorted.join("&"))
params.base = '{"platform":"cli","version":"0.1.0"}'

// 3) 发送
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
body = 各键值对 encodeURIComponent(k)=encodeURIComponent(v) 以 & 连接
```

**登录链路**

```
POST /user/qr_login_create/3                    → {scene_id, expires_in:300, qr_payload}
POST /user/qr_login_status {scene_id}           → {status, login_data}
POST /user/web_sso_ticket（带签名）              → {ticket}
POST qflow/api/v1/qzhuli/auth/ticket {ticket}   → {data:{status, login_session:{
                                                     access_token, refresh_token,
                                                     expires_in, user, teams}}}
```

**QFlow 鉴权与取数**

```
Authorization: Bearer <access_token>
x-q-flow-authorization: Bearer <access_token>

GET /api/v1/requirements?page=N&requirement_user_filter=participated
GET /api/v1/requirements/{requirement_id}/activities
```

**响应结构**

```
requirements: { code:0, data:{ items:[{ project:{project_id,project_name},
                                        requirement:{requirement_id,requirement_num,
                                                     title,category,priority,
                                                     progress_stage,progress_updated_at},
                                        current_user:{nickname,user_id,avatar} }],
                              pagination:{page,page_size,total} } }
activities:   { code:0, data:{ items:[{ activity:{action_remark,updated_at,old_stage,new_stage},
                                        user:{nickname,user_id,role_strs}, identity }] } }
```

---

## 四、模块划分

| 模块 | 职责 | 测试方式 |
|---|---|---|
| `vendor/md5.js` | MD5（blueimp-md5，MIT，转为 ESM） | 对标准向量断言 |
| `vendor/qrcode.js` | 二维码渲染（qrcode-generator，MIT） | 手测 |
| `src/sign.js` | 签名参数构造 + MD5 | 纯函数，与 `qz --dry-run` 比对 |
| `src/week.js` | 周窗口计算 + 文件命名 | 纯函数，边界用例 |
| `src/classify.js` | 板块归类（移植规则） | 纯函数，**与 `classify.py` 输出逐条比对** |
| `src/report.js` | **数据 → Markdown** | **纯函数，本次测试重点** |
| `src/qflow.js` | QFlow 取数 | mock fetch |
| `src/auth.js` | 扫码登录链路 | 需人工扫码 |
| `src/picker.js` | 目录选择与写盘 | 浏览器手测 |
| `app.js` | 界面编排 | 手测 |

**关键设计**：`week.js`、`classify.js`、`report.js`、`sign.js` 均为**零依赖纯函数**，可在 Node 下直接测试，无需浏览器、无需登录。

---

## 五、目录选择方案

浏览器安全模型**不允许**网页枚举 `C:\`、`D:\` 或遍历整个文件系统。因此采用**两步法**，在合规前提下实现"页内逐层浏览"：

1. 首次点「选择目录」→ 弹**系统原生**窗口，用户授权一个**根目录**
2. 授权后，页面内**列出子目录、逐层点进去**，选中目标文件夹
3. 授权句柄存入 IndexedDB，后续自动复用，无需重复选择

**降级**：非 Chromium 浏览器（Firefox/Safari）无 `showDirectoryPicker`，自动降级为「下载文件」。

---

## 六、周报格式

```markdown
# 黄捷 · 周报（2026-10-09 ~ 2026-10-16）

> 窗口：**2026-10-09（周五） 14:00** ~ **2026-10-16（周五） 14:00** ｜ 本周 **6 条需求**有进展 ｜ 当前积压 **5 条**

## 本周情况

### Q助理

#### 需求广场

| NO. | 需求标题 | 动作 |
| --- | --- | --- |
| NO.774 | 聊天消息中的链接自动解析网页标题 | 提出需求、提交审批、审批通过 |

## 当前积压（未完成）

### Q助理

#### 文档编辑器

| NO. | 需求标题 | 状态和卡住时间 |
| --- | --- | --- |
| NO.602 | 私人助理新增AI主动工作能力：每日前瞻 | 完善中 · 卡住10天 |

## 下周计划

- （待补充）
```

- **组织**：项目 → 板块 → 表格
- **「本周情况」**：只含登录用户本人的动作（`user == 本人`）
- **「当前积压」**：当前负责人是本人、且阶段非（待领取/已完成/已关闭）的需求，含卡住天数
- **「下周计划」**：占位，人工补充
- **无「学习」章节**
- **动作措辞**：沿用 `action_label` 大白话映射

---

## 七、错误处理

| 场景 | 处理 |
|---|---|
| 网络失败 | 提示重试，保留已取数据与勾选状态 |
| 401 / 令牌过期 | 静默 refresh；失败回登录 |
| 二维码 300 秒超时 | 提示已过期，一键刷新 |
| 单个需求动态拉取失败 | 跳过并计入失败清单，不中断整体 |
| 目录授权被拒 | 提示原因，回退下载模式 |
| 写盘失败 | 保留预览，提供「重试」与「下载」 |
| 本周无动作 | 正常生成，提示「本周无需求进展。」 |
| `npx`/依赖加载失败 | 明确提示，不静默 |

---

## 八、已知限制

1. **目录选择器仅 Chromium 可用**（`showDirectoryPicker` 为 Chrome/Edge 专有）。Firefox/Safari 降级为下载。
2. **浏览器无法枚举盘符**，需用户先授权根目录（见第五节）。
3. **`participated` 只覆盖"当前仍参与"的需求**。若某需求本周操作过、事后被移出参与人，会漏掉。本次验证未出现（6/6）。
4. **积压口径**为"当前负责人是我"，非"所有我参与且未完成"（因列表接口不返回角色 `users` 字段）。
5. **依赖 Q助理内部接口**（官方开放平台无 QFlow 能力）。Q助理改版可能失效，取数集中在 `qflow.js`，失效只改一处。

---

## 九、验收标准

| # | 标准 |
|---|---|
| 1 | Chrome/Edge 打开页面，扫码后成功登录并显示姓名 |
| 2 | 点「获取本周工作」，正确列出本周有动作的需求及条数 |
| 3 | 周窗口严格为上周五 14:00 ~ 本周五 14:00（+08:00） |
| 4 | 「本周情况」只含本人动作，不含他人 |
| 5 | 板块归类与 `classify.py` 结果一致 |
| 6 | 目录选择器可列子目录并逐层进入，选中后自动写入 |
| 7 | 文件名形如 `黄捷-10月9日-10月16日周报.md` |
| 8 | 二次使用自动复用目录授权 |
| 9 | Firefox 降级为下载，不报错 |
| 10 | 本周无动作时正常生成，提示「本周无需求进展。」 |
| 11 | 纯函数单元测试全部通过 |

---

## 十、实施顺序（降险优先）

1. `vendor/md5.js` + `src/sign.js` → 与 `qz --dry-run` 比对签名
2. `src/week.js` → 边界用例
3. `src/classify.js` → **与 `classify.py` 逐条比对**
4. `src/report.js` → 用真实数据测试
5. `src/qflow.js` → `src/auth.js`
6. `src/picker.js` → `app.js` + `index.html`
7. 端到端手测

---

## 附：材料来源

- 现有生产系统：`C:\Users\shoot\Downloads\qflow-weekly-report-x\qflow-weekly-report\`（胡力峰维护）
- 真实产出：`C:\Users\shoot\Documents\Q助理\射手科技同步盘\office-10\100-工作日志\`
- 签名算法：从本机 `@qzhuli/qzhuli-cli` v0.5.8 反解并实测验证
- 官方开放平台 API 文档：https://open.qzhuli.com/open-platform/api.html
- Q助理 CLI 使用说明：https://www.qzhuli.com/docs/view/itjVzvgNmpFDbPDx7aHeQGAYvnSznJ5c
