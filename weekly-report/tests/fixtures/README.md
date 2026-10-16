# 测试夹具（fixtures）

用于与 Python 参考实现逐字节比对，保证 JS 实现与生产脚本 `personal_weekly_report.py` 口径一致。

## 文件说明

| 文件 | 作用 |
|---|---|
| `my_requirements.json` | 我参与的需求（87 条，覆盖全部阶段含已完成） |
| `my_requirements_with_acts.json` | 上述需求的完整动态（周报生成的主输入） |
| `expected_ban_mine.json` | 上述需求的板块归类基准 |
| `expected_report_0.md` ~ `_8.md` | 9 个窗口的期望周报（与 JS 输出逐字节比对） |
| `expected_reports.json` | 上述基准的窗口清单 |
| `all_requirements.json` | 全量进行中需求（244 条，用于 classify 比对） |
| `expected_ban.json` | 上述全量需求的板块基准 |
| `classify.py` | 生产脚本副本（规则的唯一来源） |
| `classify_rules.json` / `classify_patch.json` | 由 `classify.py` 导出，避免规则副本漂移 |

## 重新生成

```powershell
# 1. 导出归类规则（从 classify.py 解析，避免副本漂移）
python fixtures/export_rules.py

# 2. 拉取「我参与的」全部需求（按阶段，含已完成）
python fixtures/fetch_all.py            # → my_requirements.json

# 3. 拉取这些需求的动态
python fixtures/fetch_my_acts.py        # → my_requirements_with_acts.json

# 4. 生成板块基准
python fixtures/gen_ban_mine.py         # → expected_ban_mine.json

# 5. 生成多窗口期望周报
python fixtures/gen_multi.py            # → expected_report_0..8.md

# 6. （可选）全量板块基准，用于 classify 比对
python fixtures/fetch_all_full.py       # → all_requirements.json  （旧版，见下）
python fixtures/gen_expected.py         # → expected_ban.json
```

> `fetch_all_full.py` 仍为旧版（拉全量进行中需求），仅用于 `classify.test.mjs` 的 243 条比对。
> 周报相关基准一律使用「我参与的」数据集（含已完成），避免漏掉已完成的工作量。

## 关键口径

- **必须按阶段拉取**：`requirement_user_filter=participated` 单独使用只返回**进行中**的需求，
  全部「已完成」会被排除（实测 19 条 vs 按阶段 87 条）。
  正确做法是 `participated` + `progress_stage` 逐阶段拉取。
- 已完成/已取消的需求同样计入周报（验收完成代表工作量）。
