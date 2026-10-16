# -*- coding: utf-8 -*-
"""拉取全量真实需求（含标题/编号/项目），作为 classify.js 的比对基准"""
import json, os, urllib.request

tok = json.load(open(os.path.expanduser("~/.qzhuli-cli/qflow-credentials.json"),
                     encoding="utf-8"))["accessToken"]

def api(path):
    req = urllib.request.Request("https://qflow.qzhuli.cn" + path,
        headers={"Authorization": "Bearer " + tok,
                 "x-q-flow-authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

items, page = [], 1
while True:
    d = api(f"/api/v1/requirements?page={page}")
    items += d["data"]["items"]
    pag = d["data"]["pagination"]
    if len(items) >= pag["total"] or not d["data"]["items"]:
        break
    page += 1

out = [{
    "project": it["project"]["project_name"],
    "requirement_id": it["requirement"]["requirement_id"],
    "requirement_num": it["requirement"]["requirement_num"],
    "title": it["requirement"]["title"],
    "category": it["requirement"]["category"],
    "progress_stage": it["requirement"]["progress_stage"],
    "progress_updated_at": it["requirement"]["progress_updated_at"],
    "current_user": (it.get("current_user") or {}).get("nickname", ""),
} for it in items]

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "all_requirements.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"已保存 {len(out)} 条 -> {path}")
