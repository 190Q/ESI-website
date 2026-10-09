from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone

MIN_SAMPLES = 8

MIN_WINDOW_COVERAGE = 0.6

STALE_WARN_DAYS = 2
STALE_UNUSABLE_DAYS = 21

DIMENSION_WEIGHTS = {
    "activity": 0.25,
    "contribution": 0.25,
    "retention": 0.20,
    "growth": 0.15,
    "load": 0.15,
}

DIMENSION_LABELS = {
    "activity": "Activity",
    "contribution": "Contribution",
    "retention": "Retention",
    "growth": "Growth",
    "load": "Load",
}

INDEX_BANDS = (
    (80, "Thriving"),
    (65, "Healthy"),
    (50, "Stable"),
    (35, "Slipping"),
    (0, "Strained"),
)

WATCHLIST_MIN_RISK = 40
WATCHLIST_MAX = 25
NEW_MEMBER_GRACE_DAYS = 14
DORMANT_DAYS = 14

RISK_WEIGHTS = {
    "recency": 0.30,
    "playtime": 0.25,
    "content": 0.25,
    "points": 0.20,
}

# Fixed scales, only for signals with no per-day history. (value, score) ordered
# by ascending value; for "lower is better" signals the score descends.
ABSOLUTE_BANDS = {
    "aspect_debt_per_member": ((0, 100), (5, 85), (12, 60), (25, 30), (40, 0)),
    "declared_inactive_share": ((0.0, 100), (0.05, 85), (0.12, 60), (0.25, 25), (0.4, 0)),
    "early_churn_share": ((0.0, 100), (0.15, 80), (0.3, 55), (0.5, 25), (0.8, 0)),
    "long_tenure_share": ((0.0, 0), (0.15, 30), (0.3, 55), (0.5, 80), (0.7, 100)),
}

METRIC_KEYS = (
    "wars", "guildRaids", "mobsKilled", "chestsFound", "questsDone",
    "totalLevel", "dungeons", "raids", "worldEvents", "caves",
)

SIGNAL_SOURCE = {
    "active_ratio_7d": "playtime",
    "playtime_per_active_7d": "playtime",
    "participation_breadth_14d": "playtime",
    "dormant_share_14d": "playtime",
    "guild_raids_week": "metrics",
    "wars_week": "metrics",
    "contributor_share_14d": "metrics",
    "content_diversity_14d": "metrics",
    "new_members_week": "metrics",
    "territory_net_30d": "territories",
    "leave_rate_30d": "events",
    "net_flow_30d": "events",
    "early_churn_share": "events",
    "join_leave_ratio_30d": "events",
}

def _clean(values):
    return [v for v in values if v is not None]


def _mean(values):
    vals = _clean(values)
    return statistics.fmean(vals) if vals else None


def _fmt(value, digits=1):
    if value is None:
        return "\u2014"
    try:
        if abs(value) >= 100:
            return f"{value:,.0f}"
        return f"{value:,.{digits}f}"
    except (TypeError, ValueError):
        return "\u2014"


def _fmt_pct(value):
    return "\u2014" if value is None else f"{value * 100:.0f}%"


def _fmt_hours(value):
    return "\u2014" if value is None else f"{value:,.1f}h"


def _percentile(value, samples, higher_is_better=True):
    if value is None:
        return None
    clean = _clean(samples)
    if len(clean) < MIN_SAMPLES:
        return None
    below = sum(1 for s in clean if s < value)
    equal = sum(1 for s in clean if s == value)
    rank = (below + 0.5 * equal) / len(clean) * 100.0
    return rank if higher_is_better else 100.0 - rank


def _absolute_score(value, key, higher_is_better=True):
    if value is None:
        return None
    bands = ABSOLUTE_BANDS.get(key)
    if not bands:
        return None
    for threshold, score in bands:
        if value <= threshold:
            return float(score)
    return float(bands[-1][1]) if higher_is_better else 0.0



def _as_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        return None


def _days_since(value, today):
    d = _as_date(value)
    return None if d is None else max(0, (today - d).days)


def _series_map(dates, values):
    """{date: value} built from a date list and a parallel value list.

    Windows are then counted in real calendar days, so a tracker with gaps (or
    one that only writes every few days) can't have its entries mistaken for
    consecutive days.
    """
    out = {}
    for raw_date, value in zip(dates or [], values or []):
        d = _as_date(raw_date)
        if d is None or d in out:
            continue
        out[d] = value
    return out


def _window_value(dmap, end, days, agg="sum", min_coverage=MIN_WINDOW_COVERAGE):
    """Aggregate the entries in [end - days + 1, end], or None if too sparse."""
    if dmap is None or end is None:
        return None
    vals = [v for d, v in dmap.items()
            if v is not None and 0 <= (end - d).days < days]
    if not vals:
        return None
    if len(vals) < max(1, days * min_coverage):
        return None
    return float(sum(vals)) if agg == "sum" else statistics.fmean(vals)


def _truncate(dates, limit):
    """How many leading entries of a chronological series fall on/before *limit*.

    The cache pads days with no snapshot with zeroes, which makes a tracker that
    died two weeks ago look perfectly fresh. The real tracker end date comes in
    from routes.py, and this trims the padding back off so the zeros are never
    mistaken for activity.
    """
    if limit is None:
        return len(dates or [])
    count = 0
    for raw in dates or []:
        d = _as_date(raw)
        if d is None or d <= limit:
            count += 1
        else:
            break
    return count


def _event_windows(dmap, end, days, steps=180):
    """Window sums for event series, where a missing day means zero events.

    Event logs (joins, leaves, territory changes) only have rows on days
    something happened, so the usual coverage guard would reject every window.
    """
    if end is None:
        return None, None, []

    def total(e):
        return float(sum(v for d, v in dmap.items() if 0 <= (e - d).days < days))

    current = total(end)
    samples = [total(end - timedelta(days=off)) for off in range(1, steps + 1)]
    return current, (_mean(samples[:4]) if samples else None), samples


def _windowed(dmap, end, days, agg="sum", min_coverage=MIN_WINDOW_COVERAGE,
              steps=60):
    """Current window, trailing baseline, and the sample distribution.

    ``current``   the window ending at the series' own last date
    ``baseline``  mean of the four windows immediately before it
    ``samples``   every window stepping back one day at a time

    Anchoring to the series' end date (rather than to today) is what keeps a
    lagging tracker from making the whole guild look dormant.
    """
    if end is None:
        return None, None, []
    current = _window_value(dmap, end, days, agg, min_coverage)
    samples = []
    for offset in range(1, steps + 1):
        value = _window_value(dmap, end - timedelta(days=offset), days, agg, min_coverage)
        if value is not None:
            samples.append(value)
    baseline = _mean(samples[:4]) if samples else None
    return current, baseline, samples


def _source(key, label, dmap, today):
    """Freshness of one underlying data source."""
    if not dmap:
        return {"key": key, "label": label, "available": False, "end": None,
                "lag_days": None, "usable": False}
    end = max(dmap)
    lag = max(0, (today - end).days)
    return {
        "key": key,
        "label": label,
        "available": True,
        "end": end.isoformat(),
        "lag_days": lag,
        "usable": lag <= STALE_UNUSABLE_DAYS,
        "stale": lag > STALE_WARN_DAYS,
    }


def _make_signal(key, label, value, samples, weight, *, higher_is_better=True,
                 baseline=None, display=None, baseline_display=None, detail="",
                 absolute_key=None, absolute_value=None, blocked_reason=None,
                 samples_used=None):
    """One sub-signal with its score and the evidence behind it."""
    score = None
    method = "unscored"

    if blocked_reason:
        method = "unusable"
        detail = (detail + " " if detail else "") + blocked_reason
    else:
        score = _percentile(value, samples, higher_is_better)
        if score is not None:
            method = "percentile"
        else:
            score = _absolute_score(
                absolute_value if absolute_value is not None else value,
                absolute_key or key,
                higher_is_better,
            )
            method = "absolute" if score is not None else "unscored"

    trend = None
    if score is not None and baseline is not None and not blocked_reason:
        base_score = _percentile(baseline, samples, higher_is_better)
        if base_score is None:
            base_score = _absolute_score(baseline, absolute_key or key, higher_is_better)
        if base_score is not None:
            trend = round(score - base_score, 1)

    return {
        "key": key,
        "label": label,
        "value": value,
        "value_display": display if display is not None else _fmt(value),
        "baseline": baseline,
        "baseline_display": baseline_display if baseline_display is not None else _fmt(baseline),
        "score": round(score, 1) if score is not None else None,
        "trend": trend,
        "weight": weight,
        "higher_is_better": higher_is_better,
        "method": method,
        "samples": samples_used if samples_used is not None else len(_clean(samples)),
        "detail": detail,
    }


def _direction(trend):
    if trend is None:
        return "unknown"
    if trend >= 3:
        return "improving"
    if trend <= -3:
        return "declining"
    return "stable"


def _band(score):
    if score is None:
        return "Unknown"
    for threshold, label in INDEX_BANDS:
        if score >= threshold:
            return label
    return INDEX_BANDS[-1][1]


def _dimension(key, signals):
    scored = [s for s in signals if s.get("score") is not None]
    base = {
        "key": key,
        "label": DIMENSION_LABELS[key],
        "weight": DIMENSION_WEIGHTS[key],
        "signals": signals,
        "scored_signals": len(scored),
    }
    if not scored:
        base.update({"score": None, "trend": None, "direction": "unknown"})
        return base

    total_weight = sum(s["weight"] for s in scored) or 1.0
    score = sum(s["score"] * s["weight"] for s in scored) / total_weight

    trends = [(s["trend"], s["weight"]) for s in scored if s.get("trend") is not None]
    trend = None
    if trends:
        tw = sum(w for _t, w in trends) or 1.0
        trend = round(sum(t * w for t, w in trends) / tw, 1)

    base.update({
        "score": round(score, 1),
        "trend": trend,
        "direction": _direction(trend),
    })
    return base



def _member_maps(members, dates, key, length=None):
    out = []
    for member in members.values():
        values = member.get(key)
        if isinstance(values, list):
            if length is not None:
                values = values[:length]
            out.append(_series_map(dates, values))
    return out


def _activity_share_map(member_maps, dates, window_days, pool_size):
    """date -> share of the pool active at least once in the trailing window."""
    out = {}
    if not pool_size:
        return out
    for d in dates:
        day = _as_date(d)
        if day is None:
            continue
        active = 0
        for mm in member_maps:
            for dd, value in mm.items():
                if value and 0 <= (day - dd).days < window_days:
                    active += 1
                    break
        out[day] = active / pool_size
    return out


def _diversity_map(member_maps_by_key, dates, window_days):
    """date -> share of tracked activities the guild touched in the window."""
    out = {}
    for d in dates:
        day = _as_date(d)
        if day is None:
            continue
        touched = 0
        for key in METRIC_KEYS:
            hit = False
            for mm in member_maps_by_key.get(key, ()):
                for dd, value in mm.items():
                    if value and 0 <= (day - dd).days < window_days:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                touched += 1
        out[day] = touched / len(METRIC_KEYS)
    return out


def _member_last_active(member_map):
    if not member_map:
        return None
    days = [d for d, v in member_map.items() if v and v > 0]
    return max(days) if days else None


def build_report(inputs):
    now = inputs.get("now") or datetime.now(timezone.utc)
    today = now.date()

    guild = inputs.get("guild") or {}
    members = inputs.get("members") or {}
    rollups = inputs.get("rollups") or []
    inactive = {str(n).lower() for n in (inputs.get("inactive") or set())}
    roster = len(rollups) or len(members)

    metric_dates = list(guild.get("metricDates") or [])
    playtime_dates = list(guild.get("dates") or [])

    metric_len = _truncate(metric_dates, _as_date(inputs.get("metric_data_end")))
    playtime_len = _truncate(playtime_dates, _as_date(inputs.get("playtime_data_end")))
    metric_dates = metric_dates[:metric_len]
    playtime_dates = playtime_dates[:playtime_len]

    metric_maps = {
        key: _series_map(metric_dates, (guild.get(key) or [])[:metric_len])
        for key in ("wars", "guildRaids", "newMembers", "totalMembers")
    }
    player_count_map = _series_map(playtime_dates, (guild.get("playerCount") or [])[:playtime_len])

    active_pool = {u: m for u, m in members.items() if u not in inactive}
    pool_size = len(active_pool) or roster or 1

    playtime_maps = _member_maps(active_pool, playtime_dates, "data", playtime_len)
    graid_maps = _member_maps(active_pool, metric_dates, "guildRaids", metric_len)
    war_maps = _member_maps(active_pool, metric_dates, "wars", metric_len)

    territory_map = _territory_series(inputs.get("territories") or {}, today)
    join_map = _count_map(inputs.get("joins") or [])
    leave_map = _count_map(inputs.get("leaves") or [])

    sources = [
        _source("playtime", "Playtime tracking", player_count_map, today),
        _source("metrics", "Activity tracking", metric_maps["wars"], today),
        _source("territories", "Territory log", territory_map, today),
        _source("events", "Roster events", _merge_maps(join_map, leave_map), today),
    ]
    by_key = {s["key"]: s for s in sources}

    notes = []
    for src in sources:
        if not src["available"]:
            notes.append(f"{src['label']}: no data found.")
        elif not src["usable"]:
            notes.append(
                f"{src['label']} is {src['lag_days']} days behind "
                f"(last record {src['end']}) - signals from it were not scored."
            )
        elif src.get("stale"):
            notes.append(
                f"{src['label']} is {src['lag_days']} days behind "
                f"(last record {src['end']})."
            )

    def _blocked(source_key):
        src = by_key.get(source_key) or {}
        if not src.get("available"):
            return f"{src.get('label', source_key)} has no data."
        if not src.get("usable"):
            return f"{src.get('label', source_key)} is {src['lag_days']} days behind, so this was not scored."
        return None

    pt_src = by_key["playtime"]
    pt_end = max(player_count_map) if player_count_map else None
    pt_block = _blocked("playtime")

    activity_signals = []

    cur, base, samples = _windowed(player_count_map, pt_end, 7, agg="mean")
    activity_signals.append(_make_signal(
        "active_ratio_7d", "Active member ratio (7d)",
        (cur / pool_size) if cur is not None else None,
        [(s / pool_size) for s in samples], 0.30, baseline=(base / pool_size) if base else None,
        display=_fmt_pct(cur / pool_size) if cur is not None else "\u2014",
        baseline_display=_fmt_pct(base / pool_size) if base else "\u2014",
        detail="Share of the roster that recorded playtime on an average day this week.",
        blocked_reason=pt_block,
    ))

    pt_per_active = {}
    for d in playtime_dates:
        day = _as_date(d)
        if day is None:
            continue
        vals = [mm.get(day) for mm in playtime_maps if mm.get(day)]
        pt_per_active[day] = statistics.fmean(vals) if vals else None
    cur, base, samples = _windowed(pt_per_active, pt_end, 7, agg="mean")
    activity_signals.append(_make_signal(
        "playtime_per_active_7d", "Playtime per active member (7d)", cur, samples, 0.30,
        baseline=base, display=_fmt_hours(cur), baseline_display=_fmt_hours(base),
        detail="Average hours played on days a member actually logged in.",
        blocked_reason=pt_block,
    ))

    breadth = _activity_share_map(playtime_maps, playtime_dates, 14, pool_size)
    cur, base, samples = _windowed(breadth, pt_end, 14, agg="mean")
    activity_signals.append(_make_signal(
        "participation_breadth_14d", "Participation breadth (14d)", cur, samples, 0.20,
        baseline=base, display=_fmt_pct(cur), baseline_display=_fmt_pct(base),
        detail="Share of the roster that played at least once in the last two weeks.",
        blocked_reason=pt_block,
    ))

    dormant = {d: 1.0 - v for d, v in breadth.items()}
    cur, base, samples = _windowed(dormant, pt_end, 14, agg="mean")
    activity_signals.append(_make_signal(
        "dormant_share_14d", "Dormant share (14d)", cur, samples, 0.20,
        higher_is_better=False, baseline=base,
        display=_fmt_pct(cur), baseline_display=_fmt_pct(base),
        detail="Share of the roster with no recorded playtime for two weeks. "
               "Members who declared inactivity are excluded.",
        blocked_reason=pt_block,
    ))

    mk_src = by_key["metrics"]
    mk_end = max(metric_maps["wars"]) if metric_maps["wars"] else None
    mk_block = _blocked("metrics")

    invalid = {str(d) for d in (guild.get("invalidGuildRaidDays") or [])}
    graid_map = {d: v for d, v in metric_maps["guildRaids"].items()
                 if d.isoformat() not in invalid}

    contribution_signals = []

    cur, base, samples = _windowed(graid_map, mk_end, 7)
    contribution_signals.append(_make_signal(
        "guild_raids_week", "Guild raids (7d)", cur, samples, 0.25, baseline=base,
        detail="Guild raids completed in the last 7 days of recorded data. Days the "
               "cache flagged as invalid are excluded.",
        blocked_reason=mk_block,
    ))

    cur, base, samples = _windowed(metric_maps["wars"], mk_end, 7)
    contribution_signals.append(_make_signal(
        "wars_week", "Wars (7d)", cur, samples, 0.20, baseline=base,
        detail="Wars won by the guild over the last 7 recorded days.",
        blocked_reason=mk_block,
    ))

    content_maps = []
    for graid, war in zip(graid_maps, war_maps):
        merged = dict(graid)
        for d, v in war.items():
            merged[d] = (merged.get(d) or 0) + (v or 0)
        content_maps.append(merged)
    contributors = _activity_share_map(content_maps, metric_dates, 14, pool_size)
    cur, base, samples = _windowed(contributors, mk_end, 14, agg="mean")
    contribution_signals.append(_make_signal(
        "contributor_share_14d", "Contributors (14d)", cur, samples, 0.20,
        baseline=base, display=_fmt_pct(cur), baseline_display=_fmt_pct(base),
        detail="Share of the roster that contributed a guild raid or a war in two weeks.",
        blocked_reason=mk_block,
    ))

    diversity = _diversity_map(
        {k: _member_maps(active_pool, metric_dates, k) for k in METRIC_KEYS},
        metric_dates, 14,
    )
    cur, base, samples = _windowed(diversity, mk_end, 14, agg="mean")
    contribution_signals.append(_make_signal(
        "content_diversity_14d", "Content diversity (14d)", cur, samples, 0.15,
        baseline=base, display=_fmt_pct(cur), baseline_display=_fmt_pct(base),
        detail="How many of the tracked activities the guild touched in two weeks. "
               "A guild doing only raids scores low here even if raid volume is high.",
        blocked_reason=mk_block,
    ))

    completed_medians = list(inputs.get("points_completed_medians") or [])
    latest_median = inputs.get("points_latest_median")
    prior_median = inputs.get("points_prior_median")

    contribution_signals.append(_make_signal(
        "esi_points_per_member", "ESI points per member (last finished cycle)",
        latest_median,
        completed_medians[:-1] if len(completed_medians) > 1 else [], 0.10,
        baseline=prior_median,
        display=_fmt(latest_median, 0), baseline_display=_fmt(prior_median, 0),
        detail="Median EP earned per member in the most recent cycle that finished, "
               "ranked against every cycle before it. The cycle in progress is not "
               "scored.",
    ))

    terr_end = max(territory_map) if territory_map else None
    cur, base, samples = _event_windows(territory_map, terr_end, 30)
    contribution_signals.append(_make_signal(
        "territory_net_30d", "Territory net (30d)", cur, samples, 0.10,
        display=f"{cur:+.0f}" if cur is not None else "\u2014",
        detail="Territories captured minus territories lost over the last 30 days.",
        blocked_reason=_blocked("territories"),
    ))

    ev_end = max(_merge_maps(join_map, leave_map)) if (join_map or leave_map) else None
    ev_block = _blocked("events")

    cur, base, samples = _event_windows(leave_map, ev_end, 30)
    leave_rate = (cur / roster) if (cur is not None and roster) else None
    leave_samples = [s / roster for s in samples] if roster else []
    retention_signals = [
        _make_signal(
            "leave_rate_30d", "Leave rate (30d)", leave_rate, leave_samples, 0.30,
            higher_is_better=False,
            baseline=(base / roster) if (base is not None and roster) else None,
            display=_fmt_pct(leave_rate),
            baseline_display=_fmt_pct(base / roster) if (base is not None and roster) else "\u2014",
            detail="Members who left in the last 30 days as a share of the roster.",
            blocked_reason=ev_block,
        ),
    ]

    net_map = {}
    for d in set(join_map) | set(leave_map):
        net_map[d] = (join_map.get(d) or 0) - (leave_map.get(d) or 0)
    cur, base, samples = _event_windows(net_map, ev_end, 30)
    net_rate = (cur / roster) if (cur is not None and roster) else None
    retention_signals.append(_make_signal(
        "net_flow_30d", "Net flow (30d)", net_rate,
        [s / roster for s in samples] if roster else [], 0.25,
        baseline=(base / roster) if (base is not None and roster) else None,
        display=_fmt_pct(net_rate),
        baseline_display=_fmt_pct(base / roster) if (base is not None and roster) else "\u2014",
        detail="Joins minus leaves over the last 30 days, as a share of the roster.",
        blocked_reason=ev_block,
    ))

    early = None
    if not ev_block:
        recent = [l for l in (inputs.get("leaves") or [])
                  if (_days_since(l.get("timestamp"), today) or 9999) <= 90]
        with_tenure = [l for l in recent if l.get("tenure_seconds") is not None]
        if with_tenure:
            early = sum(1 for l in with_tenure
                        if l["tenure_seconds"] < 30 * 86400) / len(with_tenure)
    retention_signals.append(_make_signal(
        "early_churn_share", "Early churn share (90d)", early, [], 0.20,
        higher_is_better=False, display=_fmt_pct(early),
        absolute_key="early_churn_share", absolute_value=early,
        detail="Share of the last 90 days of departures that left within 30 days of "
               "joining. High here points at recruiting fit rather than activity.",
    ))

    tenures = [t for t in (_days_since(r.get("joined"), today) for r in rollups) if t is not None]
    long_tenure = (sum(1 for t in tenures if t >= 180) / len(tenures)) if tenures else None
    retention_signals.append(_make_signal(
        "long_tenure_share", "Long-tenure share (6m+)", long_tenure, [], 0.25,
        display=_fmt_pct(long_tenure),
        absolute_key="long_tenure_share", absolute_value=long_tenure,
        detail="Share of the current roster that has been here six months or longer.",
    ))

    cur, base, samples = _windowed(metric_maps["newMembers"], mk_end, 7)
    growth_signals = [
        _make_signal(
            "new_members_week", "New members (7d)", cur, samples, 0.45, baseline=base,
            detail="Members who joined the guild in the last 7 recorded days.",
            blocked_reason=mk_block,
        ),
    ]

    queue_map = _series_map(
        [q.get("date") for q in (inputs.get("queue_history") or [])],
        [q.get("total") for q in (inputs.get("queue_history") or [])],
    )
    q_end = max(queue_map) if queue_map else None
    cur, base, samples = _windowed(queue_map, q_end, 7, agg="mean")
    growth_signals.append(_make_signal(
        "queue_depth_7d", "Join queue depth (7d)", cur, samples, 0.30, baseline=base,
        detail="Average number of applicants waiting in the join queue. Depth is demand "
               "for the guild, so higher is better here.",
        blocked_reason=None if queue_map else "No queue history was found.",
    ))

    j_cur, _, j_samples = _event_windows(join_map, ev_end, 30)
    l_cur, _, l_samples = _event_windows(leave_map, ev_end, 30)
    cur = None
    samples = []
    if j_cur is not None and l_cur is not None:
        cur = j_cur / l_cur if l_cur > 0 else float(j_cur)
        for j, l in zip(j_samples, l_samples):
            samples.append(j / l if l > 0 else float(j))
    base = _mean(samples[:4]) if samples else None
    growth_signals.append(_make_signal(
        "join_leave_ratio_30d", "Joins per departure (30d)", cur, samples, 0.25,
        display=_fmt(cur, 2),
        detail="Above 1 means the guild is out-recruiting its losses over 30 days.",
        blocked_reason=ev_block,
    ))

    aspects = inputs.get("aspects") or {}
    debt = None
    if aspects.get("total") is not None and roster:
        debt = float(aspects["total"]) / roster
    load_signals = [
        _make_signal(
            "aspect_debt_per_member", "Aspect debt per member", debt, [], 0.60,
            higher_is_better=False, display=_fmt(debt, 1),
            absolute_key="aspect_debt_per_member", absolute_value=debt,
            detail="Total aspects owed divided by the roster. Scored on a fixed scale "
                   "because there is no per-day history for it.",
        ),
    ]

    inactive_share = (len(inactive) / roster) if roster else None
    load_signals.append(_make_signal(
        "declared_inactive_share", "Declared inactive share", inactive_share, [], 0.40,
        higher_is_better=False, display=_fmt_pct(inactive_share),
        absolute_key="declared_inactive_share", absolute_value=inactive_share,
        detail="Share of the roster on a declared inactivity exemption. Not counted "
               "against activity, but a large share is still a load signal.",
    ))

    dimensions = [
        _dimension("activity", activity_signals),
        _dimension("contribution", contribution_signals),
        _dimension("retention", retention_signals),
        _dimension("growth", growth_signals),
        _dimension("load", load_signals),
    ]

    scored_dims = [d for d in dimensions if d["score"] is not None]
    index_score = None
    index_trend = None
    if scored_dims:
        tw = sum(d["weight"] for d in scored_dims) or 1.0
        index_score = round(sum(d["score"] * d["weight"] for d in scored_dims) / tw, 1)
        trends = [(d["trend"], d["weight"]) for d in scored_dims if d["trend"] is not None]
        if trends:
            ttw = sum(w for _t, w in trends) or 1.0
            index_trend = round(sum(t * w for t, w in trends) / ttw, 1)

    lags = [s["lag_days"] for s in sources if s.get("lag_days") is not None]
    worst_lag = max(lags) if lags else None
    used_sources = {
        SIGNAL_SOURCE.get(s["key"])
        for dim in dimensions
        for s in dim["signals"]
        if s.get("score") is not None
    }
    scored_lags = [
        by_key[k]["lag_days"] for k in used_sources
        if k in by_key and by_key[k].get("lag_days") is not None
    ]
    worst_scored_lag = max(scored_lags) if scored_lags else None
    freshness = 1.0 if worst_scored_lag is None else max(0.0, 1.0 - worst_scored_lag / 28.0)

    history_days = max(
        len(metric_maps["wars"]), len(player_count_map)
    )
    history_factor = min(1.0, history_days / 56.0)
    roster_factor = (len(active_pool) / roster) if roster else 0.0
    dims_factor = (len(scored_dims) / len(dimensions)) if dimensions else 0.0
    base_coverage = _mean([history_factor, roster_factor, dims_factor]) or 0.0
    coverage = base_coverage * freshness

    if worst_scored_lag is None:
        freshness_note = "The scored signals are up to date."
    else:
        freshness_note = (
            f"The freshest data behind the scored signals is {worst_scored_lag} days old."
        )
    confidence_factors = [
        {
            "key": "history",
            "label": "History depth",
            "value": round(history_factor, 4),
            "display": f"{history_days} days of activity history; 56 days or more scores full marks.",
        },
        {
            "key": "roster",
            "label": "Roster coverage",
            "value": round(roster_factor, 4),
            "display": f"{len(active_pool)} of {roster} members have activity data.",
        },
        {
            "key": "dimensions",
            "label": "Dimensions scored",
            "value": round(dims_factor, 4),
            "display": f"{len(scored_dims)} of {len(dimensions)} dimensions could be scored.",
        },
        {
            "key": "freshness",
            "label": "Data freshness",
            "value": round(freshness, 4),
            "display": freshness_note + " Reaches 0% at 28 days behind.",
            "multiplier": True,
        },
    ]

    if history_days and history_days < 28:
        notes.append(f"Only {history_days} days of activity history - trends are weak.")
    if not completed_medians:
        notes.append(
            "No finished ESI point cycles were found, so the per-member EP signal "
            "could not be scored."
        )
    if not inactive:
        notes.append("No declared-inactivity records were found.")
    if worst_scored_lag is not None and worst_scored_lag > STALE_WARN_DAYS:
        notes.append(
            f"The freshest data behind the scored signals is {worst_scored_lag} days "
            "old, so this describes the guild as it was then, not today."
        )

    confidence_label = "high" if coverage >= 0.75 else "medium" if coverage >= 0.5 else "low"
    if confidence_label == "low":
        notes.append("Not enough current data to be confident in this index.")

    watchlist, excluded = _watchlist(
        active_pool, rollups, inactive, playtime_maps, playtime_dates,
        today, inputs, blocked_reason=pt_block,
        metric_dates=metric_dates, metric_len=metric_len,
    )

    return {
        "available": index_score is not None,
        "generated_at": now.isoformat(),
        "roster": roster,
        "history_days": history_days,
        "data_lag_days": worst_lag,
        "data_sources": sources,
        "index": {
            "score": index_score,
            "band": _band(index_score),
            "trend": index_trend,
            "direction": _direction(index_trend),
            "confident": confidence_label != "low",
        },
        "confidence": {
            "score": round(coverage * 100, 1),
            "label": confidence_label,
            "history_days": history_days,
            "worst_lag_days": worst_lag,
            "worst_scored_lag_days": worst_scored_lag,
            "coverage": round(base_coverage * 100, 1),
            "freshness": round(freshness * 100, 1),
            "scored_dimensions": len(scored_dims),
            "total_dimensions": len(dimensions),
            "factors": confidence_factors,
            "notes": notes,
        },
        "dimensions": dimensions,
        "watchlist": watchlist,
        "excluded": excluded,
        "weights": {"dimensions": DIMENSION_WEIGHTS, "risk": RISK_WEIGHTS},
    }


def _count_map(events):
    out = {}
    for ev in events or []:
        d = _as_date(ev.get("timestamp"))
        if d is None:
            continue
        out[d] = out.get(d, 0) + 1
    return out


def _merge_maps(*maps):
    out = {}
    for m in maps:
        for d, v in (m or {}).items():
            out[d] = out.get(d, 0) + (v or 0)
    return out


def _territory_series(territories, today):
    """{date: +1/-1} from the territory capture/loss log."""
    history = territories.get("history") if isinstance(territories, dict) else None
    if not isinstance(history, list):
        return {}
    out = {}
    for ev in history:
        if not isinstance(ev, dict):
            continue
        d = _as_date(ev.get("timestamp"))
        if d is None:
            continue
        kind = str(ev.get("type") or "").lower()
        if "captur" in kind:
            out[d] = out.get(d, 0) + 1
        elif "lost" in kind:
            out[d] = out.get(d, 0) - 1
    return out



def _watchlist(active_pool, rollups, inactive, playtime_maps, playtime_dates,
               today, inputs, blocked_reason=None, metric_dates=None, metric_len=None):
    rollup_by_user = {}
    for r in rollups:
        name = str(r.get("username") or "").lower()
        if name:
            rollup_by_user[name] = r

    maps_by_user = {}
    for (ulow, _member), mm in zip(active_pool.items(), playtime_maps):
        maps_by_user[ulow] = mm

    if blocked_reason:
        return [], {
            "inactive": len(inactive),
            "new_members": 0,
            "suppressed_reason": blocked_reason,
        }

    current_points = inputs.get("points_latest_by_user") or {}
    previous_points = inputs.get("points_prior_by_user") or {}

    results = []
    excluded_new = 0

    for ulow, member in active_pool.items():
        rollup = rollup_by_user.get(ulow)
        if rollup is None:
            continue

        tenure = _days_since(rollup.get("joined"), today)
        if tenure is not None and tenure < NEW_MEMBER_GRACE_DAYS:
            excluded_new += 1
            continue

        scores = {}
        notes = []
        pt_map = maps_by_user.get(ulow) or {}

        last_active = _member_last_active(pt_map)
        days_since = None
        if last_active is not None:
            days_since = max(0, (today - last_active).days)
        if days_since is None:
            scores["recency"] = 100.0
            notes.append("no recorded playtime in the tracked window")
        else:
            scores["recency"] = min(100.0, days_since / DORMANT_DAYS * 100.0)
            if days_since >= 7:
                notes.append(f"last played {days_since}d ago")

        pt_end = max(pt_map) if pt_map else None
        cur, base, _ = _windowed(pt_map, pt_end, 7) if pt_end else (None, None, [])
        if cur is not None and base and base > 0.2:
            decline = max(0.0, 1.0 - (cur / base))
            scores["playtime"] = min(100.0, decline * 100.0)
            if decline >= 0.5:
                notes.append(f"playtime {cur:.1f}h this week vs {base:.1f}h/wk before")
        else:
            scores["playtime"] = 0.0

        content = {}
        for key in ("guildRaids", "wars"):
            values = member.get(key)
            if isinstance(values, list):
                if metric_len is not None:
                    values = values[:metric_len]
                for d, v in _series_map(metric_dates or [], values).items():
                    content[d] = (content.get(d) or 0) + (v or 0)
        c_end = max(content) if content else None
        c_cur, c_base, _ = _windowed(content, c_end, 7) if c_end else (None, None, [])
        if c_cur is not None and c_base and c_base > 0.2:
            decline = max(0.0, 1.0 - (c_cur / c_base))
            scores["content"] = min(100.0, decline * 100.0)
            if decline >= 0.5:
                notes.append(
                    f"{c_cur:.0f} raids and wars this week vs {c_base:.0f}/wk before"
                )
        else:
            scores["content"] = 0.0

        cp = current_points.get(ulow)
        pp = previous_points.get(ulow)
        if cp is not None and pp and pp > 0:
            decline = max(0.0, 1.0 - (float(cp) / float(pp)))
            scores["points"] = min(100.0, decline * 100.0)
            if decline >= 0.5:
                notes.append(f"{int(cp)} EP this cycle vs {int(pp)} last cycle")
        else:
            scores["points"] = 0.0

        risk = sum(scores.get(k, 0.0) * w for k, w in RISK_WEIGHTS.items())
        if risk < WATCHLIST_MIN_RISK:
            continue

        results.append({
            "username": rollup.get("username") or ulow,
            "rank": rollup.get("rank"),
            "tenure_days": tenure,
            "risk": round(risk, 1),
            "band": "high" if risk >= 70 else "medium",
            "days_since_active": days_since,
            "signals": {k: round(v, 1) for k, v in scores.items()},
            "reasons": notes or ["activity trending down across several signals"],
        })

    results.sort(key=lambda r: -r["risk"])
    return results[:WATCHLIST_MAX], {
        "inactive": len(inactive),
        "new_members": excluded_new,
    }
