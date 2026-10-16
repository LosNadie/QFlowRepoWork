# -*- coding: utf-8 -*-
"""用原版 personal_weekly_report.py 的逻辑生成期望周报，供 JS 逐字节比对"""
import json, os, re, sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TZ = timezone(timedelta(hours=8))
WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

def week_window(now):
    days_since_friday = (now.weekday() - 4) % 7
    end_candidate = (now - timedelta(days=days_since_friday)).replace(hour=14, minute=0, second=0, microsecond=0)
    if end_candidate > now and now.weekday() != 4:
        end_candidate -= timedelta(days=7)
    return end_candidate - timedelta(days=7), end_candidate

def local_dt(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(TZ)
    except Exception:
        return None

def dt_head(dt):
    return f"{dt.strftime('%Y-%m-%d')}（{WEEK[dt.weekday()]}）"

def action_label(a):
    old, new = a.get("old"), a.get("new")
    remark = a.get("remark") or ""
    if old == "提出" and new == "待审批": return "提出需求"
    if "修改" in remark and old == new: return "修改负责人"
    if "优先级" in remark: return "调整优先级"
    if "推荐" in remark and old == new: return "推荐实现人"
    if ("管理" in remark or "安排" in remark) and old == new: return "调整协作人"
    if "将" in remark and "改为" in remark and old == new: return "修改字段"
    trans = {
        ("待审批","待完善"):"完善需求", ("待完善","完善中"):"完善需求",
        ("待领取","待完善"):"完善需求", ("待审批","完善中"):"完善需求",
        ("研发中","待完善"):"退回完善",
        ("完善中","待审批"):"提交审批", ("待完善","待审批"):"提交审批",
        ("待审批","待领取"):"审批通过",
        ("待领取","研发中"):"开始研发",
        ("研发中","待验收"):"提测",
        ("待验收","验收中"):"开始验收", ("待验收","已完成"):"测试完成",
        ("验收中","已完成"):"测试完成", ("验收中","已关闭"):"测试完成",
        ("验收中","研发中"):"回到研发",
        ("待完善","已取消"):"取消需求", ("待领取","已取消"):"取消需求",
        ("已取消","待完善"):"恢复需求", ("研发中","待领取"):"退回待领取",
    }
    if (old, new) in trans: return trans[(old, new)]
    if new and new != old: return f"流转到「{new}」"
    return "操作"

def strip_prefix(title):
    return re.sub(r"^\s*【[^】]*】\s*", "", title or "").strip()

def kazai(stage, users, current_user=""):
    rm = {}
    for u in users:
        rm.setdefault(u.get("role_code"), u.get("nickname"))
    m = {"待审批":"approver","待完善":"refiner","完善中":"refiner",
         "研发中":"developer","待验收":"tester","验收中":"tester"}
    for s, role in m.items():
        if stage == s and role in rm: return rm[role]
    if stage in ("待完善","待审批") and "creator" in rm: return rm["creator"]
    if current_user and stage in m: return current_user
    return None

def stuck_person(r):
    stage = r["progress_stage"]
    if stage in ("待领取","已完成","已关闭"): return None
    return kazai(stage, r.get("users", []), r.get("current_user", "")) or None

def days_in_stage(ts, today):
    try:
        d = datetime.fromisoformat(ts.replace("Z","+00:00")).date()
        return (datetime.strptime(today, "%Y-%m-%d").date() - d).days
    except Exception:
        return "?"

def render_by_ban(rows, cols):
    lines = []
    for proj in sorted({r[0] for r in rows}):
        lines += ["", f"### {proj}"]
        sub = [r for r in rows if r[0] == proj]
        bans = {}
        for r in sub:
            bans.setdefault(r[1], []).append(r)
        for ban in sorted(bans):
            lines += ["", f"#### {ban}", "",
                      f"| NO. | 需求标题 | {cols} |", "| --- | --- | --- |"]
            for _, _, num, title, cell in sorted(bans[ban], key=lambda x: x[2]):
                lines.append(f"| NO.{num} | {title} | {cell} |")
    return lines

# ---- 数据：用真实抓取的需求 + 动态（覆盖全部阶段，含已完成）----
reqs = json.load(open(os.path.join(HERE, "my_requirements_with_acts.json"), encoding="utf-8"))
banmap = json.load(open(os.path.join(HERE, "expected_ban_mine.json"), encoding="utf-8"))
for r in reqs:
    r["ban"] = banmap.get(r["requirement_id"], "通用/未分类")

PERSON = sys.argv[1] if len(sys.argv) > 1 else "黄捷"
# 固定 now，保证可复现
NOW = datetime.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else datetime.now(TZ)
start, end = week_window(NOW)
today = NOW.strftime("%Y-%m-%d")

rows = []
for r in reqs:
    acts = []
    for a in r.get("activities", []):
        if a.get("user") != PERSON or not a.get("at"): continue
        t = local_dt(a["at"])
        if t and start <= t < end: acts.append(action_label(a))
    if acts:
        rows.append((r["project"], r["ban"], r["requirement_num"], strip_prefix(r.get("title")), "、".join(acts)))

bl_rows = []
for r in reqs:
    if stuck_person(r) != PERSON: continue
    bl_rows.append((r["project"], r["ban"], r["requirement_num"], strip_prefix(r.get("title")),
                    f"{r['progress_stage']} · 卡住{days_in_stage(r.get('progress_updated_at',''), today)}天"))

L = [f"# {PERSON} · 周报（{start.strftime('%Y-%m-%d')} ~ {end.strftime('%Y-%m-%d')}）", ""]
L += [f"> 窗口：**{dt_head(start)} 14:00** ~ **{dt_head(end)} 14:00** ｜ "
      f"本周 **{len(rows)} 条需求**有进展 ｜ 当前积压 **{len(bl_rows)} 条**", ""]

L += ["## 本周情况", ""]
if rows:
    L += render_by_ban(rows, "动作"); L.append("")
else:
    L += ["本周无需求进展。", ""]

L += ["## 当前积压（未完成）", ""]
if bl_rows:
    L += render_by_ban(bl_rows, "状态和卡住时间"); L.append("")
else:
    L += ["- （无）", ""]

L += ["## 下周计划", "", "- （待补充）", ""]
L += ["---", "", "*本文件由脚本生成，可直接在文档内编辑补充。*"]

text = "\n".join(L).rstrip() + "\n"
out = os.path.join(HERE, "expected_report.md")
open(out, "w", encoding="utf-8").write(text)
print(f"已生成期望周报 -> {out}")
print(f"窗口: {dt_head(start)} 14:00 ~ {dt_head(end)} 14:00")
print(f"本周 {len(rows)} 条 / 积压 {len(bl_rows)} 条")

