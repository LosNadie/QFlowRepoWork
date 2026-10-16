# -*- coding: utf-8 -*-
"""从现有 classify.py 直接导出规则与 PATCH，避免规则副本漂移。
classify.py 用 Python dict 字面量，这里用 ast 解析出 RULES / PATCH。
"""
import ast, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "classify.py")
tree = ast.parse(open(SRC, encoding="utf-8").read())

RULES = PATCH = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        name = node.targets[0].id
        if name == "RULES":
            RULES = ast.literal_eval(node.value)
        elif name == "PATCH":
            PATCH = {f"{k[0]}|{k[1]}": v for k, v in ast.literal_eval(node.value).items()}

if RULES is None or PATCH is None:
    raise SystemExit("未能从 classify.py 解析出 RULES / PATCH")

# RULES: {项目: [(关键词列表, 板块), ...]} → JSON 可序列化
rules = {p: [[list(kws), ban] for kws, ban in v] for p, v in RULES.items()}

json.dump(rules, open(os.path.join(HERE, "classify_rules.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump(PATCH, open(os.path.join(HERE, "classify_patch.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

nkw = sum(len(kws) for v in rules.values() for kws, _ in v)
print(f"已导出 classify.py 规则: {len(rules)} 个项目, {nkw} 个关键词, {len(PATCH)} 条精确覆盖")
