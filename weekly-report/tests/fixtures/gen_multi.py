# -*- coding: utf-8 -*-
"""批量生成多个窗口的期望周报，用于 JS 侧批量比对"""
import json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TZ = timezone(timedelta(hours=8))

# 选取多个窗口起点（周五），覆盖不同数据分布
WINDOWS = [
    "2026-10-16T14:00:00+08:00",
    "2026-10-09T14:00:00+08:00",
    "2026-09-25T14:00:00+08:00",
    "2026-09-11T14:00:00+08:00",
    "2026-08-28T14:00:00+08:00",
    "2026-08-14T14:00:00+08:00",
    "2026-07-31T14:00:00+08:00",
    "2026-10-14T12:00:00+08:00",   # 非周五，测回退
    "2026-10-19T10:00:00+08:00",   # 周一
]

results = []
for i, now_iso in enumerate(WINDOWS):
    out = os.path.join(HERE, f"expected_report_{i}.md")
    subprocess.run([sys.executable, os.path.join(HERE, "gen_expected_report.py"), "黄捷", now_iso],
                   check=True, capture_output=True)
    # gen_expected_report.py 固定输出到 expected_report.md，改名
    src = os.path.join(HERE, "expected_report.md")
    os.replace(src, out)
    results.append({"index": i, "now": now_iso, "file": f"expected_report_{i}.md"})

json.dump(results, open(os.path.join(HERE, "expected_reports.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(f"已生成 {len(results)} 份期望周报")
for r in results:
    txt = open(os.path.join(HERE, r["file"]), encoding="utf-8").read()
    m = re.search(r'本周 \*\*(\d+) 条需求\*\*有进展 ｜ 当前积压 \*\*(\d+) 条', txt)
    print(f"  [{r['index']}] {r['now'][:16]}  本周{m.group(1)}条 / 积压{m.group(2)}条")
