# 周报生成器 设计文档

- 日期：2026-10-16
- 状态：待评审
- 作者：与 DSH 协作产出

---

## 一、目标与范围

### 1.1 要解决的问题

用户（黄捷）每周需要手写周报，素材散落在 QFlow 的需求流转记录里，需要人工翻查、汇总、排版，重复且易漏。

### 1.2 三条核心需求

1. 用 Q助理登录
2. 获取 QFlow 本周工作内容
3. 一键生成周报，存入本地相应位置

### 1.3 明确不做（YAGNI）

- 不做周报的云端存储与历史管理
- 不做团队多人周报汇总
- 不接 AI 润色（本期用模板化生成，理由见 5.2）
- 不做定时自动生成（本期为手动触发）
- 不做正式对外发布（本期为内部自用）

---

## 二、关键约束（已实测验证）

本节所有结论均经实际请求验证，非推测。

### 2.1 官方开放平台没有 QFlow 接口 —— 这是本设计的根本约束

查阅 `https://open.qzhuli.com/open-platform/api.html`（2026-10-16），官方开放平台对外提供的**全部**接口为：

| 接口 | 用途 |
|---|---|
| `GET /oauth/authorize` | 扫码授权 |
| `POST /oauth/access_token` | 换 token |
| `POST /open/user/info` | 用户信息 |
| `POST /open/message/push` | 单个消息推送 |
| `POST /open/message/broadcast` | 群发消息 |
| `GET /open/message/records` | 发送记录 |
| `POST /open/message/read_status` | 已读状态 |
| `GET /open/stats/overview` | 统计概览 |
| `GET /open/stats/private_users` | 私域用户列表 |

**没有任何 QFlow 需求接口**，授权 scope 仅有 `user_info`。

因此需求 2（获取 QFlow 工作内容）**无法通过官方开放平台实现**。本设计采用**内部接口**方案（见 2.4），并接受其风险（见 7.1）。

### 2.2 CORS 实测结果

| 目标 | 方法 | 结果 |
|---|---|---|
| `client.qzhuli.com/user/qr_login_create/3` | POST | `Access-Control-Allow-Origin: *` |
| `client.qzhuli.com/user/qr_login_status` | POST | `Access-Control-Allow-Origin: *` |
| `qflow.qzhuli.cn/api/v1/*` | OPTIONS 预检 | 回显 Origin，允许 `authorization, x-q-flow-authorization, content-type`，`Allow-Credentials: true` |

结论：扫码登录与 QFlow 取数**均可在浏览器内直接完成**，无需自建后端中转。

### 2.3 接口与算法（从已安装的 `qz` v0.5.8 反解并核对）

**登录链路**

```
POST client.qzhuli.com/user/qr_login_create/3        → { scene_id, expires_in: 300, qr_payload }
POST client.qzhuli.com/user/qr_login_status {scene_id} → { status, login_data }
     login_data = { uid, tk, token, cid, id?, nickname?, avatar? }
POST client.qzhuli.com/user/web_sso_ticket            → { ticket }
POST qflow.qzhuli.cn/api/v1/qzhuli/auth/ticket {ticket} → { login_session: { accessToken, refreshToken, expiresAt, user, teams } }
```

**请求签名**（`client.qzhuli.com` 侧，表单编码）

```
result.r    = 16 字节随机 hex
result.uid  = uid          （需鉴权时）
result.tk   = tk           （需鉴权时）
result.base = {"platform":"cli","version":"0.1.0"}
result.key  = MD5( 按 key 字典序拼接 "k=v" 以 "&" 连接，末尾追加 "token=<token>" )

Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

**QFlow 侧鉴权**

```
Authorization: Bearer <accessToken>
x-q-flow-authorization: Bearer <accessToken>
```

**QFlow 取数接口**

| 接口 | 用途 |
|---|---|
| `GET /api/v1/requirements/mine` | 我负责的需求 |
| `GET /api/v1/requirements/{id}` | 需求详情（项目/分类/风险/参与人） |
| `GET /api/v1/requirements/{id}/activities` | 流转记录（含时间戳，周报主原料） |
| `GET /api/v1/requirements/{id}/comments` | 评论 |
| `GET /api/v1/projects` | 项目列表 |

### 2.4 关键实现风险：浏览器不支持 MD5

`calculateSignature` 使用 MD5。**浏览器 Web Crypto API 不提供 MD5**（仅 SHA 系列）。因此必须内置纯 JS MD5 实现（约 100 行，无第三方依赖）。

### 2.5 浏览器目录写入限制

`window.showDirectoryPicker()` 是 **Chromium 专有 API**（Chrome / Edge），Firefox 与 Safari 不支持。降级方案见 4.4。

---

## 三、架构

```
┌─────────────────────────────────────────────────────────┐
│  静态网页（HTML + 原生 JS，无框架、无构建步骤）              │
│                                                          │
│  ┌────────────┐   ┌─────────────┐   ┌────────────────┐  │
│  │  qz-auth   │──▶│  qz-flow    │──▶│  report-build  │  │
│  │ 扫码登录    │   │ 取本周工作   │   │ 模板化 Markdown │  │
│  └────────────┘   └─────────────┘   └────────────────┘  │
│         │                                     │          │
│         ▼                                     ▼          │
│  ┌────────────┐                        ┌────────────────┐│
│  │  md5.js    │                        │  file-writer   ││
│  │ 纯 JS 签名  │                        │ 目录授权 + 写盘 ││
│  └────────────┘                        └────────────────┘│
└─────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
  client.qzhuli.com                       用户本地磁盘
  qflow.qzhuli.cn
```

**设计原则：分层隔离，每层可独立测试**

| 模块 | 职责 | 依赖 | 可测试性 |
|---|---|---|---|
| `md5.js` | 纯 JS MD5 | 无 | 纯函数，对已知向量测试 |
| `sign.js` | 构造签名参数、计算 `key` | md5.js | 纯函数，对 `qz --dry-run` 输出比对 |
| `qz-auth.js` | 扫码登录 → 换 SSO → 换 QFlow token | sign.js, fetch | 需人工扫码 |
| `qz-flow.js` | 拉取需求与动态 | qz-auth.js | 可 mock fetch |
| `report.js` | **数据 → Markdown** | 无 | **纯函数，本期测试重点** |
| `file-writer.js` | 目录授权与写盘 | showDirectoryPicker | 需浏览器手测 |
| `app.js` | 界面与流程编排 | 全部 | 手测 |

**关键决策**：`report.js` 为**零依赖纯函数**，输入为结构化数据、输出为 Markdown 字符串。这样周报逻辑可在 Node 下用真实数据直接测试，无需浏览器、无需登录。

---

## 四、功能设计

### 4.1 登录（需求 1）

- 页面加载时检查 `localStorage` 中的 QFlow token 是否过期
- 未登录：请求 `qr_login_create`，用纯 JS 渲染二维码（不引入第三方二维码库，见 8.2），显示 300 秒倒计时
- 每 5 秒轮询 `qr_login_status`，拿到 `login_data` 后自动完成 SSO 换票与 QFlow 换 token
- 已登录：显示昵称与头像，提供「退出登录」
- token 过期：静默用 `refreshToken` 刷新；刷新失败则回到扫码

### 4.2 取本周工作（需求 2）

1. 计算本周区间（见 4.3）
2. `GET /requirements/mine` 拿到需求清单
3. 对**每个**需求并发拉取 `activities` 与详情
4. 按时间戳过滤出区间内的动态
5. **保留全部动态**（用户已明确选择"我负责需求上的全部动态"，含他人操作），但在每条上标注操作人
6. 丢弃本周无任何动态的需求
7. 界面展示命中的需求与动态条数，每条动态可勾选排除（默认全选）

**已探明的真实数据规模**（2026-10-16 实测）：`mine` 返回 5 条需求，本周（10-12~10-18）有动态的仅 2 条，共 6 条动态。请求量为 5 次详情 + 5 次动态 = 10 次，可接受。

### 4.3 周区间定义

用户选择**周一 00:00 ~ 周五 23:59:59**（本地时区）。

> 决策记录：候选方案另有"周一~周日"与"可选时间范围"，用户明确选择**周一~周五**。本期**不提供**区间切换开关（YAGNI），如后续需要再扩展。

### 4.4 输出与写盘（需求 3）

**主路径（Chrome / Edge）**

```
showDirectoryPicker() → 用户选择目录 → 授权句柄存入 IndexedDB
→ 写入 <所选目录>/周报/黄捷-2026-W42.md
```

- 首次使用需用户手动选一次目录
- 句柄持久化到 IndexedDB，后续自动复用，无需重复选择
- 写入前检查同名文件，存在则提示覆盖 / 自动加序号

**降级路径（Firefox / Safari）**

检测到 `showDirectoryPicker` 不存在时，隐藏目录选择器，改为「下载 Markdown 文件」按钮，落到浏览器默认下载目录，并明确提示原因。

**文件命名**

```
周报/黄捷-2026-W42.md
```

其中 `W42` 为 ISO 周数。同名时追加 `-2`、`-3`。

### 4.5 周报模板（模板化，不调 AI）

```markdown
# 周报 · 黄捷 · 2026-10-12 ~ 2026-10-16（第 42 周）

## 一、本周概览

- 涉及需求：2 个
- 动态记录：6 条
- 按项目分布：Q助理 2 个

## 二、需求进展

### 1. 团队群离开/回归团队后群资料人数、成员列表、时光相册及退出状态异常

- **项目**：Q助理 ｜ **分类**：BUG修复 ｜ **优先级**：中 ｜ **当前阶段**：完善中
- **本周动态**：
  - `10-16 10:47` 需求提出（黄捷）
  - `10-16 10:50` 状态：待审批 → 完善中（黄捷）
  - `10-16 10:56` 优先级：高 → 中（黄捷）

### 2. 手机端长按消息从底部弹出操作选项卡（类似飞书），先实现重要功能

- **项目**：Q助理 ｜ **分类**：新功能 ｜ **优先级**：中 ｜ **当前阶段**：完善中
- **本周动态**：
  - `10-15 09:06` 需求提出（胡力峰）
  - `10-15 10:46` 状态：待审批 → 待完善（胡力峰）
  - `10-15 11:04` 状态：待完善 → 完善中（黄捷）

## 三、下周计划

- 继续推进「团队群离开/回归团队后…异常」（完善中）
- 继续推进「手机端长按消息从底部弹出操作选项卡…」（完善中）
```

**「下周计划」生成规则**：列出我负责、且当前阶段为「完善中」或「待完善」的需求标题。**该节为自动推导，用户可在预览界面手动编辑后再写盘。**

---

## 五、错误处理

### 5.1 分级处理

| 场景 | 处理 |
|---|---|
| 网络失败 | 提示重试，保留已取数据，不丢用户勾选状态 |
| 401 / token 过期 | 自动 refresh；失败则回登录页 |
| 二维码 300 秒超时 | 提示已过期，一键刷新 |
| 单个需求详情拉取失败 | **跳过该需求并在报告末尾附「获取失败清单」**，不中断整体 |
| 目录授权被拒 | 提示原因，回退到下载模式 |
| 写盘失败（磁盘满/无权限） | 保留预览内容，提供「重试」与「下载」双出口 |
| 本周无任何动态 | 正常生成，概览区提示「本周无记录」，不报错 |

### 5.2 为何不接 AI 润色

用户明确选择**模板化汇总，不调 AI**。理由：

1. 零 API Key、零成本、零延迟
2. 输出**完全可预测**，适合作为周期性交付物
3. 事实准确性由数据源保证，不存在模型幻觉风险

后续如需 AI 润色，可在预览层加一个可选按钮，不改动数据层。

---

## 六、测试策略

| 层级 | 方式 |
|---|---|
| `md5.js` | 对标准测试向量（`""`、`"abc"`、长字符串）断言 |
| `sign.js` | 用固定输入，与 `qz --dry-run` 输出的 `key` 逐字符比对 |
| `report.js` | **用已抓取的真实 5 条需求数据构造 fixture**，覆盖：正常周、空周、跨周边界、无动态、他人操作、单需求失败 |
| `qz-flow.js` | mock fetch，覆盖 401 / 500 / 空列表 / 字段缺失 |
| 端到端 | 浏览器手测：扫码 → 取数 → 选目录 → 写盘 → 打开文件核对 |

**真实 fixture 已具备**：本文档编写期间已从 QFlow 抓到 5 条需求及其完整流转记录，可直接作为 `report.js` 的测试输入。

---

## 七、风险与应对

### 7.1 使用非公开内部接口（主要风险）

- **风险**：Q助理改版可能变更内部接口，导致工具失效
- **依据**：官方开放平台不提供 QFlow 数据能力（见 2.1）
- **已接受**：用户明确选择方案 B，定位为**内部自用**，不对外发布
- **应对**：
  1. 接口调用集中在 `qz-flow.js`，失效时只改一处
  2. 保留 `qz` CLI 作为**降级数据源**（见 7.2）
  3. 文档记录接口来源与反解版本（`qz` v0.5.8）

### 7.2 降级数据源：`qz` CLI

本机 `qz` CLI 已登录且能取到全部所需数据。因此把「取数」与「拼模板」解耦：

- `report.js` 接受结构化数据，**不关心数据来自网页还是 CLI**
- 开发顺序上**先用 CLI 数据验证模板与取数逻辑**，再接入浏览器登录

这样即使登录链路受阻，也能立刻产出可用的周报。

### 7.3 其他风险

| 风险 | 应对 |
|---|---|
| 浏览器不支持 MD5 | 内置纯 JS 实现 |
| Firefox/Safari 无目录 API | 降级为下载（4.4） |
| `mine` 不含已转交他人的需求 | **已知限制**，见 9.2 |
| 首次选目录体验 | 句柄持久化，仅需一次 |

---

## 八、技术选型

### 8.1 无框架、无构建

原生 HTML + ES Module + CSS。理由：

- 功能单一，引入 React/Vue 与打包链是过度设计
- 免构建 → 双击 `index.html` 或任意静态服务器即可运行，便于内部传阅
- 依赖越少，逆向接口失效时的维护成本越低

### 8.2 依赖策略

| 需求 | 方案 |
|---|---|
| MD5 | 自实现（约 100 行） |
| 二维码渲染 | **内置 `qrcode-generator` v1.4.4**（MIT，56KB，已验证无外部依赖、暴露全局 `qrcode`）。文件置于 `vendor/qrcode.js`，**不使用 CDN**，以保证离线可用与版本可控。不自实现 QR 编码器——编码易错且非本项目核心价值 |
| 日期/周数 | 自实现（ISO 周数约 20 行） |

### 8.3 文件结构

```
weekly-report/
├─ index.html
├─ style.css
├─ app.js            # 界面与流程编排
├─ qz-auth.js        # 扫码登录 + SSO + QFlow token
├─ qz-flow.js        # QFlow 取数
├─ sign.js           # 签名构造
├─ md5.js            # 纯 JS MD5
├─ report.js         # 数据 → Markdown（纯函数）
├─ file-writer.js    # 目录授权与写盘
├─ week.js           # 周区间与 ISO 周数计算
├─ vendor/
│  └─ qrcode.js      # qrcode-generator v1.4.4（MIT，本地内置）
└─ tests/
   ├─ md5.test.js
   ├─ sign.test.js
   ├─ report.test.js
   └─ fixtures/
      └─ real-requirements.json   # 真实抓取数据
```

---

## 九、已知限制（须向用户明确）

### 9.1 目录选择器仅 Chromium 可用

`showDirectoryPicker` 为 Chrome / Edge 专有。Firefox / Safari 用户降级为下载文件。**浏览器无法枚举盘符或逐层浏览整个文件系统**——这是浏览器安全模型决定的，非实现缺陷。

### 9.2 `mine` 接口的口径限制

`GET /requirements/mine` 只返回**当前归我负责**的需求。若某需求本周由我处理、但事后已转交他人，该需求**不会出现**在周报中。

`GET /api/v1/requirements` 支持按项目筛选，但**不支持按人 + 时间筛选**，因此无法低成本补齐这一缺口。若要覆盖，需遍历各项目下全部需求，请求量与耗时不可控。

**结论**：本期接受该限制，并在界面上向用户说明。

### 9.3 登录链路未经端到端验证

扫码登录需要用户本人用手机确认，**无法由开发方独立验证**。这是全项目唯一未验证环节。

**应对**：实施第一步就是打通登录链路，再写其余部分（见 7.2 的开发顺序）。

### 9.4 时区

所有时间戳按**本地时区**（Asia/Shanghai, UTC+8）解释。QFlow 返回 UTC 时间（如 `2026-10-16T02:56:05+00:00`），需转换为本地时间后再判定周区间，否则周五晚间与周一凌晨的记录会错位。

---

## 十、验收标准

| # | 标准 |
|---|---|
| 1 | Chrome 下打开页面，扫码后成功登录并显示昵称 |
| 2 | 点击「获取本周工作」，正确列出本周有动态的需求及条数 |
| 3 | 本周区间严格为周一 00:00 ~ 周五 23:59:59（本地时区） |
| 4 | 生成周报内容与 QFlow 实际记录一致，时间与操作人无错 |
| 5 | 选择目录后，文件正确写入 `<目录>/周报/黄捷-2026-W42.md` |
| 6 | 二次使用时自动复用目录授权，无需重复选择 |
| 7 | Firefox 下降级为下载，不报错 |
| 8 | 本周无动态时正常生成，提示「本周无记录」 |
| 9 | `report.js` 单元测试对真实 fixture 全部通过 |
| 10 | 单个需求拉取失败时，其余需求正常生成，失败项列于末尾 |

---

## 十一、实施顺序（降险优先）

1. **验证登录链路**（唯一未验证环节，先打通）
2. `week.js` + `md5.js` + `sign.js`，用 `qz --dry-run` 比对签名
3. `report.js` + 真实 fixture 测试（**此步完成即产出可用的周报核心**）
4. `qz-flow.js` 取数
5. `file-writer.js` 目录授权与写盘
6. `app.js` 界面编排
7. 端到端手测

---

## 附：文档来源

- 官方开放平台 API 文档：https://open.qzhuli.com/open-platform/api.html （2026-10-16 查阅）
- Q助理 CLI 使用说明：https://www.qzhuli.com/docs/view/itjVzvgNmpFDbPDx7aHeQGAYvnSznJ5c （2026-10-16 查阅）
- 接口与算法：从本机 `@qzhuli/qzhuli-cli` v0.5.8 反解，并经实际 HTTP 请求验证
