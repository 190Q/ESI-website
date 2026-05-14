import os
import sqlite3
import sys

from config import _POINTS_DB, _SHOP_DB, _USERNAME_MATCHES_JSON, _load_json_file


def _mc_uuid(discord_id: str) -> str | None:
    """Look up the Minecraft UUID tied to a Discord ID via username_matches.json."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, dict):
        return entry.get("uuid")
    return None

def _mc_username_from_matches(discord_id: str) -> str | None:
    """Look up the Minecraft username tied to a Discord ID."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("username")
    return None

def resolve_uuid_for_user(discord_id: str) -> tuple[str | None, str | None]:
    """Return ``(mc_uuid, mc_username)`` for a Discord user.

    Falls back to querying esi_points.db by username if the matches file
    has a username but no uuid.
    """
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None, None

    if isinstance(entry, str):
        mc_username = entry
        mc_uuid = None
    elif isinstance(entry, dict):
        mc_username = entry.get("username")
        mc_uuid = entry.get("uuid")
    else:
        return None, None

    # If we have a uuid already, return it
    if mc_uuid:
        return mc_uuid, mc_username

    # Fallback: resolve uuid from esi_points by username
    if mc_username and os.path.isfile(_POINTS_DB):
        try:
            conn = sqlite3.connect(_POINTS_DB, timeout=5)
            row = conn.execute(
                "SELECT uuid FROM esi_points WHERE LOWER(username) = LOWER(?) LIMIT 1",
                (mc_username,),
            ).fetchone()
            conn.close()
            if row:
                return row[0], mc_username
        except sqlite3.Error:
            pass

    return None, mc_username

def fetch_ep_balance(uuid: str) -> dict:
    """Compute the full EP balance for a player UUID.

    Returns a dict with keys: clean_ep, dirty_ep, total_ep,
    reserved_clean, reserved_dirty, spendable_clean, spendable_dirty.
    """
    # 1. Accumulated EP from esi_points (sum across ALL cycles)
    clean_ep = 0
    dirty_ep = 0
    if os.path.isfile(_POINTS_DB):
        try:
            conn = sqlite3.connect(_POINTS_DB, timeout=5)
            row = conn.execute(
                "SELECT COALESCE(SUM(clean_ep), 0), COALESCE(SUM(dirty_ep), 0) "
                "FROM esi_points WHERE uuid = ?",
                (uuid,),
            ).fetchone()
            if row:
                clean_ep = int(row[0])
                dirty_ep = int(row[1])
            conn.close()
        except sqlite3.Error as exc:
            print(f"[EP] Failed to read esi_points: {exc}", file=sys.stderr)

    # 2. Active reservations from esi_points.db
    reserved_clean = 0
    reserved_dirty = 0
    if os.path.isfile(_POINTS_DB):
        try:
            conn = sqlite3.connect(_POINTS_DB, timeout=5)
            rows = conn.execute(
                "SELECT ep_type, COALESCE(SUM(reserved_amount), 0) "
                "FROM ep_reservations "
                "WHERE uuid = ? AND released_at IS NULL "
                "GROUP BY ep_type",
                (uuid,),
            ).fetchall()
            for ep_type, amount in rows:
                if ep_type == "clean":
                    reserved_clean = int(amount)
                elif ep_type == "dirty":
                    reserved_dirty = int(amount)
            conn.close()
        except sqlite3.Error as exc:
            print(f"[EP] Failed to read ep_reservations: {exc}", file=sys.stderr)

    # 3. Shop spending from shop.db (pending + fulfilled bin purchases)
    spent_clean = 0
    spent_dirty = 0
    donated_dirty = 0
    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            row = conn.execute(
                "SELECT COALESCE(SUM(clean_ep_spent), 0), "
                "       COALESCE(SUM(dirty_ep_spent), 0) "
                "FROM bin_purchases "
                "WHERE uuid = ? AND status IN ('pending', 'fulfilled')",
                (uuid,),
            ).fetchone()
            if row:
                spent_clean = int(row[0])
                spent_dirty = int(row[1])

            # Confirmed donation tickets add to dirty balance
            don_row = conn.execute(
                "SELECT COALESCE(SUM(dirty_ep_to_grant), 0) "
                "FROM donation_tickets "
                "WHERE uuid = ? AND status = 'confirmed'",
                (uuid,),
            ).fetchone()
            if don_row:
                donated_dirty = int(don_row[0])
            conn.close()
        except sqlite3.Error as exc:
            print(f"[EP] Failed to read shop.db: {exc}", file=sys.stderr)

    # 4. Assemble final balances
    effective_clean = clean_ep - spent_clean
    effective_dirty = dirty_ep - spent_dirty + donated_dirty
    spendable_clean = effective_clean - reserved_clean
    spendable_dirty = effective_dirty - reserved_dirty

    return {
        "clean_ep":        effective_clean,
        "dirty_ep":        effective_dirty,
        "total_ep":        effective_clean + effective_dirty,
        "reserved_clean":  reserved_clean,
        "reserved_dirty":  reserved_dirty,
        "spendable_clean": max(spendable_clean, 0),
        "spendable_dirty": max(spendable_dirty, 0),
    }

class InsufficientFunds(Exception):
    """Raised when the player cannot afford the requested spend."""

    def __init__(self, needed: int, available: int, message: str | None = None):
        self.needed = needed
        self.available = available
        super().__init__(
            message or f"Insufficient EP: need {needed}, have {available} spendable"
        )

def resolve_spend(
    uuid: str,
    amount: int,
    spend_order: str,
) -> dict:
    """Determine how to split *amount* EP between clean and dirty.

    Parameters
    ----------
    uuid : str
        The player's Minecraft UUID.
    amount : int
        Total EP to spend.
    spend_order : str
        One of ``"clean_first"``, ``"dirty_first"``,
        ``"clean_only"``, ``"dirty_only"``.

    Returns
    -------
    dict
        ``{"clean_to_spend": int, "dirty_to_spend": int}``

    Raises
    ------
    InsufficientFunds
        If the player does not have enough spendable EP.
    ValueError
        If *spend_order* is not recognised.
    """
    if amount <= 0:
        return {"clean_to_spend": 0, "dirty_to_spend": 0}

    balance = fetch_ep_balance(uuid)
    sc = balance["spendable_clean"]
    sd = balance["spendable_dirty"]

    if spend_order == "clean_only":
        if sc < amount:
            raise InsufficientFunds(amount, sc, "Not enough clean EP")
        return {"clean_to_spend": amount, "dirty_to_spend": 0}

    if spend_order == "dirty_only":
        if sd < amount:
            raise InsufficientFunds(amount, sd, "Not enough dirty EP")
        return {"clean_to_spend": 0, "dirty_to_spend": amount}

    if spend_order == "clean_first":
        from_clean = min(sc, amount)
        remainder = amount - from_clean
        from_dirty = min(sd, remainder)
        if from_clean + from_dirty < amount:
            raise InsufficientFunds(amount, sc + sd)
        return {"clean_to_spend": from_clean, "dirty_to_spend": from_dirty}

    if spend_order == "dirty_first":
        from_dirty = min(sd, amount)
        remainder = amount - from_dirty
        from_clean = min(sc, remainder)
        if from_clean + from_dirty < amount:
            raise InsufficientFunds(amount, sc + sd)
        return {"clean_to_spend": from_clean, "dirty_to_spend": from_dirty}

    raise ValueError(f"Unknown spend_order: {spend_order!r}")
