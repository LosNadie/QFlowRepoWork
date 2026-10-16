# -*- coding: utf-8 -*-
"""为「我参与的」全部需求（含已完成/已取消）生成板块基准。
复用原版 classify.py 的规则，保证与线上口径一致。
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
items = json.load(open(os.path.join(HERE, "my_requirements_with_acts.json"), encoding="utf-8"))

def strip_prefix(t):
    return re.sub(r'^\s*【[^】]*】\s*', '', t or '').strip()

# ---- 以下 RULES / PATCH / classify 与现有 classify.py 完全一致 ----
RULES = json.load(open(os.path.join(HERE, "classify_rules.json"), encoding="utf-8"))
PATCH = json.load(open(os.path.join(HERE, "classify_patch.json"), encoding="utf-8"))

def classify(proj, title, num):
    t = strip_prefix(title)
    patch = PATCH.get("%s|%s" % (proj, num))
    if patch: return patch
    for entry in RULES.get(proj, []):
        for kw in entry[0]:
            if kw in t:
                return entry[1]
    return '通用/未分类'

expected = {}
for it in items:
    expected[it["requirement_id"]] = classify(it["project"], it["title"], it["requirement_num"])

path = os.path.join(HERE, "expected_ban_mine.json")
json.dump(expected, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"已生成 {len(expected)} 条板块基准 -> {path}")

from collections import Counter
c = Counter(expected.values())
print("板块分布:", dict(c.most_common()))
