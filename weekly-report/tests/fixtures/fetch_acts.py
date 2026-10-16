# -*- coding: utf-8 -*-
"""抓取 243 条需求的动态（activities），作为周报比对数据。
列表接口不返回 users 角色字段，故只取 current_user —— 与 fetch_detail_acts.py 口径一致。
"""
import json, os, urllib.request, time

HERE = os.path.dirname(os.path.abspath(__file__))
tok = json.load(open(os.path.expanduser("~/.qzhuli-cli/qflow-credentials.json"),
                     encoding="utf-8"))["accessToken"]

def api(path):
    req = urllib.request.Request("https://qflow.qzhuli.cn" + path,
        headers={"Authorization": "Bearer " + tok,
                 "x-q-flow-authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

items = json.load(open(os.path.join(HERE, "all_requirements.json"), encoding="utf-8"))
out = []
for i, it in enumerate(items):
    rec = dict(it)
    rec["users"] = []  # 列表接口不返回角色信息，与参考脚本口径一致
    try:
        a = api(f"/api/v1/requirements/{it['requirement_id']}/activities")
        rec["activities"] = [{
            "remark": (x.get("activity") or {}).get("action_remark"),
            "at": (x.get("activity") or {}).get("updated_at") or "",
            "user": (x.get("user") or {}).get("nickname"),
            "old": (x.get("activity") or {}).get("old_stage"),
            "new": (x.get("activity") or {}).get("new_stage"),
        } for x in a.get("data", {}).get("items", [])]
    except Exception as e:
        rec["activities"] = []
    out.append(rec)
    if (i + 1) % 50 == 0:
        print(f"  {i+1}/{len(items)}", flush=True)

path = os.path.join(HERE, "requirements_with_acts.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"已保存 {len(out)} 条 -> {path}")
