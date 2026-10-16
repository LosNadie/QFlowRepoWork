# -*- coding: utf-8 -*-
"""按阶段拉取"黄捷参与过"的全部需求（含已完成），作为完整基准。
修复：原先只拉 participated（仅返回进行中），漏掉全部已完成需求。
"""
import json, os, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
tok = json.load(open(os.path.expanduser("~/.qzhuli-cli/qflow-credentials.json"),
                     encoding="utf-8"))["accessToken"]

STAGES = ['待领取','待审批','待完善','完善中','研发中','待验收','验收中','已完成','已关闭','已取消']

def api(path):
    req = urllib.request.Request("https://qflow.qzhuli.cn" + path,
        headers={"Authorization": "Bearer " + tok,
                 "x-q-flow-authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

by_id = {}
for st in STAGES:
    got, page = [], 1
    while True:
        q = (f"/api/v1/requirements?page={page}"
             f"&requirement_user_filter=participated"
             f"&progress_stage={urllib.parse.quote(st)}")
        d = api(q)
        items = d["data"]["items"]
        got += items
        pag = d["data"]["pagination"]
        if len(got) >= pag["total"] or not items:
            break
        page += 1
    for it in got:
        r = it["requirement"]
        by_id[r["requirement_id"]] = {
            "project": it["project"]["project_name"],
            "requirement_id": r["requirement_id"],
            "requirement_num": r["requirement_num"],
            "title": r["title"],
            "category": r["category"],
            "priority": r.get("priority", ""),
            "progress_stage": r["progress_stage"],
            "progress_updated_at": r["progress_updated_at"],
            "current_user": (it.get("current_user") or {}).get("nickname", ""),
            "users": [],   # 列表接口不返回角色信息
        }
    if got:
        print(f"  {st}: {len(got)}")

out = list(by_id.values())
path = os.path.join(HERE, "my_requirements.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\n合计 {len(out)} 条（修复前只有 19 条）-> {path}")

from collections import Counter
print("阶段分布:", dict(Counter(r["progress_stage"] for r in out)))
