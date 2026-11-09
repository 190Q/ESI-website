"""Swiss-system pairings, colours and standings.

Pure functions over the tournament state dict built by ``store.py``. No Flask
and no file access, so the whole tournament can be exercised on its own.
"""

from __future__ import annotations

WIN = 1.0
DRAW = 0.5
LOSS = 0.0
BYE_POINTS = 1.0

# Cap on the pairing search. Without a rematch restriction the search always
# succeeds on its first branch, so this only bounds the rematch-free pass.
_PAIR_NODE_BUDGET = 40000


def active_players(state) -> list:
    """Players still taking part in the event."""
    return [p for p in (state.get("players") or []) if not p.get("withdrawn")]


def player_map(state) -> dict:
    return {p["id"]: p for p in (state.get("players") or []) if p.get("id")}


def match_points(match) -> dict:
    """Points awarded by *match*, keyed by player id."""
    if not isinstance(match, dict):
        return {}
    bye = match.get("bye")
    if bye:
        return {bye: BYE_POINTS}
    white = match.get("white")
    black = match.get("black")
    if not white or not black:
        return {}
    result = match.get("result")
    if result == "white":
        return {white: WIN, black: LOSS}
    if result == "black":
        return {white: LOSS, black: WIN}
    if result == "draw":
        return {white: DRAW, black: DRAW}
    return {}


def round_complete(rnd) -> bool:
    """True when every board of *rnd* has a result (byes count as played)."""
    matches = (rnd or {}).get("matches") or []
    if not matches:
        return False
    for match in matches:
        if match.get("bye"):
            continue
        if not match.get("white") or not match.get("black"):
            return False
        if not match.get("result"):
            return False
    return True


def all_rounds_complete(state) -> bool:
    rounds = state.get("rounds") or []
    return bool(rounds) and all(round_complete(r) for r in rounds)


def _played_pairs(state) -> set:
    pairs = set()
    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            white = match.get("white")
            black = match.get("black")
            if white and black:
                pairs.add(frozenset((white, black)))
    return pairs


def _previous_byes(state) -> set:
    byes = set()
    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            if match.get("bye"):
                byes.add(match["bye"])
    return byes


def _color_history(state) -> dict:
    """Per-player colour history, in round order."""
    history = {}
    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            white = match.get("white")
            black = match.get("black")
            if white:
                history.setdefault(white, []).append("w")
            if black:
                history.setdefault(black, []).append("b")
    return history


def _color_pref(history) -> int:
    """Positive means the player would rather have white."""
    if not history:
        return 0
    whites = history.count("w")
    blacks = len(history) - whites
    last = history[-1]
    if len(history) >= 2 and history[-1] == history[-2]:
        # Two of the same colour in a row, they should switch.
        pref = 2 if last == "b" else -2
    else:
        pref = 1 if last == "b" else -1
    return pref + (blacks - whites)


def _assign_colors(a, b, history, rating, name):
    """Return (white, black) for the pair *a*, *b*."""
    pref_a = _color_pref(history.get(a, []))
    pref_b = _color_pref(history.get(b, []))
    if pref_a != pref_b:
        return (a, b) if pref_a > pref_b else (b, a)
    whites_a = history.get(a, []).count("w")
    whites_b = history.get(b, []).count("w")
    if whites_a != whites_b:
        return (a, b) if whites_a < whites_b else (b, a)
    rating_a = rating.get(a, 0)
    rating_b = rating.get(b, 0)
    if rating_a != rating_b:
        return (a, b) if rating_a > rating_b else (b, a)
    return (a, b) if name.get(a, "") <= name.get(b, "") else (b, a)


def _pair_pool(pool, played, allow_rematch):
    """Pair *pool* (best player first) avoiding games already played.

    Returns a list of (player, player) tuples, or None when no complete
    pairing exists within the search budget.
    """
    budget = [_PAIR_NODE_BUDGET]

    def recurse(rest):
        if not rest:
            return []
        if budget[0] <= 0:
            return None
        budget[0] -= 1
        first = rest[0]
        for index in range(1, len(rest)):
            opponent = rest[index]
            if not allow_rematch and frozenset((first, opponent)) in played:
                continue
            tail = recurse(rest[1:index] + rest[index + 1:])
            if tail is not None:
                return [(first, opponent)] + tail
        return None

    return recurse(list(pool))


def generate_round(state, number=None) -> list:
    """Build the boards for the next round.

    Players are ordered by score, then rating, then name, and matched within
    that order. A rematch is only allowed when nothing else is possible. With
    an odd number of active players the lowest scoring player who has not had
    a bye yet sits the round out.
    """
    players = active_players(state)
    if len(players) < 2:
        raise ValueError("At least two active players are needed to pair a round.")

    standings = compute_standings(state)
    score = {row["id"]: row["points"] for row in standings}
    rating = {p["id"]: int(p.get("rating") or 0) for p in players}
    name = {p["id"]: (p.get("name") or p["id"]) for p in players}

    def sort_key(player_id):
        return (
            -score.get(player_id, 0.0),
            -rating.get(player_id, 0),
            name.get(player_id, "").lower(),
        )

    ordered = sorted([p["id"] for p in players], key=sort_key)

    bye_id = None
    if len(ordered) % 2 == 1:
        already_byed = _previous_byes(state)
        for player_id in reversed(ordered):
            if player_id not in already_byed:
                bye_id = player_id
                break
        if bye_id is None:
            bye_id = ordered[-1]
        ordered = [player_id for player_id in ordered if player_id != bye_id]

    played = _played_pairs(state)
    pairs = _pair_pool(ordered, played, allow_rematch=False)
    if pairs is None:
        pairs = _pair_pool(ordered, played, allow_rematch=True)
    if pairs is None:
        raise ValueError("Could not pair the players for this round.")

    history = _color_history(state)
    matches = []
    for index, (first, second) in enumerate(pairs, start=1):
        white, black = _assign_colors(first, second, history, rating, name)
        matches.append({
            "board": index,
            "white": white,
            "black": black,
            "bye": None,
            "result": None,
        })

    if bye_id:
        matches.append({
            "board": len(matches) + 1,
            "white": None,
            "black": None,
            "bye": bye_id,
            "result": None,
        })
    return matches


def compute_standings(state) -> list:
    """Final-table rows, ordered by points and Buchholz Cut 1.

    Buchholz is the sum of every opponent's score, with a bye counting as 0.
    Buchholz Cut 1 drops the lowest of those opponent scores, which is the bye
    when the player has one.
    """
    players = player_map(state)
    points = {pid: 0.0 for pid in players}
    wins = {pid: 0 for pid in players}
    draws = {pid: 0 for pid in players}
    losses = {pid: 0 for pid in players}
    byes = {pid: 0 for pid in players}
    opponents = {pid: [] for pid in players}

    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            bye = match.get("bye")
            if bye:
                if bye in points:
                    points[bye] += BYE_POINTS
                    byes[bye] += 1
                continue
            white = match.get("white")
            black = match.get("black")
            if not white or not black:
                continue
            if white not in points or black not in points:
                continue
            opponents[white].append(black)
            opponents[black].append(white)
            result = match.get("result")
            if result == "white":
                points[white] += WIN
                wins[white] += 1
                losses[black] += 1
            elif result == "black":
                points[black] += WIN
                wins[black] += 1
                losses[white] += 1
            elif result == "draw":
                points[white] += DRAW
                points[black] += DRAW
                draws[white] += 1
                draws[black] += 1

    rows = []
    for player_id, player in players.items():
        opponent_points = [points.get(opponent, 0.0) for opponent in opponents[player_id]]
        buchholz = sum(opponent_points)
        cut_one = buchholz - min(opponent_points) if opponent_points else 0.0
        rows.append({
            "id": player_id,
            "name": player.get("name") or player_id,
            "rating": int(player.get("rating") or 0),
            "withdrawn": bool(player.get("withdrawn")),
            "played": len(opponent_points) + byes[player_id],
            "wins": wins[player_id],
            "draws": draws[player_id],
            "losses": losses[player_id],
            "byes": byes[player_id],
            "points": round(points[player_id], 2),
            "buchholz": round(buchholz, 2),
            "buchholz_cut1": round(cut_one, 2),
        })

    rows.sort(key=lambda row: (
        -row["points"],
        -row["buchholz_cut1"],
        -row["buchholz"],
        -row["wins"],
        -row["rating"],
        row["name"].lower(),
    ))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows
