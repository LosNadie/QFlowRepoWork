# -*- coding: utf-8 -*-
"""抓取「我参与的」全部需求的动态（含已完成），重建周报比对基准"""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
tok = json.load(open(os.path.expanduser("~/.qzhuli-cli/qflow-credentials.json"),
                     encoding="utf-8"))["accessToken"]

def api(path):
    req = urllib.request.Request("https://qflow.qzhuli.cn" + path,
        headers={"Authorization": "Bearer " + tok,
                 "x-q-flow-authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

items = json.load(open(os.path.join(HERE, "my_requirements.json"), encoding="utf-8"))
print(f"待抓取 {len(items)} 条")

def fetch(it):
    rec = dict(it)
    try:
        a = api(f"/api/v1/requirements/{it['requirement_id']}/activities")
        rec["activities"] = [{
            "remark": (x.get("activity") or {}).get("action_remark"),
            "at": (x.get("activity") or {}).get("updated_at") or "",
            "user": (x.get("user") or {}).get("nickname"),
            "old": (x.get("activity") or {}).get("old_stage"),
            "new": (x.get("activity") or {}).get("new_stage"),
        } for x in a.get("data", {}).get("items", [])]
    except Exception:
        rec["activities"] = []
    return rec

out, done = [], 0
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = [ex.submit(fetch, it) for it in items]
    for f in as_completed(futs):
        out.append(f.result())
        done += 1
        if done % 20 == 0:
            print(f"  {done}/{len(items)}")

path = os.path.join(HERE, "my_requirements_with_acts.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"已保存 {len(out)} 条 -> {path}")
