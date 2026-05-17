# ESI Shop

Guild shop system for the ESI website. Members spend EP (Experience Points) earned from gameplay cycles to purchase items or bid in auctions. Admins manage the catalogue, fulfill orders, and moderate auctions.

## Modules

| File | Purpose |
|---|---|
| `__init__.py` | Package exports |
| `items.py` | Item catalogue loader — reads `shop_items.json`, applies DB overrides, filters by rank visibility and top-N position |
| `ep_balance.py` | EP balance computation — reads earned EP from `esi_points.db` (read-only), reservations + spending from `shop.db` |
| `bin.py` | Fixed-price purchases — item listing with cooldowns, single purchase, cart checkout |
| `auction.py` | Auction system — bidding, anti-snipe, settlement, ending-soon reminders, orphan cleanup |
| `cart.py` | Server-side cart persistence per user |
| `donate.py` | LE-to-EP donation tickets (pending until admin confirms) |
| `orders.py` | Order history queries |
| `admin.py` | Admin operations — item CRUD, stock/active overrides, queue fulfillment, auction management, bid removal, logs |
| `leaderboard.py` | Cycle leaderboard persistence — lazily caches per-cycle positions from `esi_points.db` into `shop.db` for top-N visibility |
| `dm_cards.py` | Branded notification card renderer — HTML template → Playwright screenshot → PNG |

## Data stores

**`shop.db`** (SQLite WAL) — all shop transaction state:
- `bin_purchases` — purchase records with EP spend breakdown
- `auctions` — auction instances with status, highest bid, end time
- `bids` — individual bids per auction
- `ep_reservations` — EP holds for active auction bids (prevents double-spend)
- `cooldowns` — per-user item cooldown tracking
- `cart_items` — persisted cart contents
- `donation_tickets` — LE donation records
- `item_overrides` — admin stock/active toggles
- `cycle_leaderboard` — cached per-cycle leaderboard positions (for `visible_to_top_n` item gating)
- `shop_admin_log` — audit trail

**`esi_points.db`** (read-only from this app) — earned EP per cycle, owned by ESI-Bot.

**`shop_items.json`** — item catalogue. Written atomically (temp file + rename) by admin operations. Read by `items.py` and merged with `item_overrides` from the DB.

## EP balance model

```
earned EP          ← esi_points.db (immutable, written by ESI-Bot)
+ donated dirty EP ← shop.db donation_tickets (confirmed)
- spent EP         ← shop.db bin_purchases (pending + fulfilled)
- reserved EP      ← shop.db ep_reservations (active auction bids)
= spendable EP
```

Balance checks for purchases and bids run inside `BEGIN IMMEDIATE` transactions to prevent TOCTOU double-spend.

## Auction lifecycle

1. Admin starts auction → row in `auctions` with `status='active'`
2. Users place bids → EP reserved in `ep_reservations`, displaced bidder's reservation released
3. Anti-snipe: bids in the last N seconds extend the end time (capped at cycle_end - 2h)
4. Background worker (`auction_close_loop`) runs every 60s:
   - Sends ending-soon reminders (~6h before close)
   - Settles expired auctions (winners get `bin_purchases` rows, losers get EP released)
   - Cleans up orphaned reservations
5. Admin can cancel auctions or remove individual bids at any time

## DM notification cards

All Discord DMs use branded image cards rendered by `dm_cards.py`:
- HTML/CSS template with ESI colour palette
- Playwright screenshots the `.card` element with transparent background
- 15 card types covering all shop events (bid placed, outbid, won, lost, cancelled, fulfilled, etc.)
- Falls back to plain text if Playwright is unavailable
- All content sanitized to strip @everyone, role pings, and invite links before sending

Test cards: `python test_dm_cards.py --help`

## API endpoints

### User endpoints (guild members)
- `GET /api/shop/bin` — item listing with balance and cooldowns
- `POST /api/shop/bin/purchase` — single item purchase
- `POST /api/shop/bin/cart/checkout` — multi-item cart checkout
- `GET /api/shop/cart` / `PUT /api/shop/cart` — cart persistence
- `GET /api/shop/auctions` — active + recent auctions
- `POST /api/shop/auctions/bid` — place a bid
- `POST /api/shop/donate` — submit LE donation
- `GET /api/shop/donations` — donation history
- `GET /api/shop/orders` — full order history
- `GET /api/me/ep-balance` — EP balance breakdown

### Admin endpoints (Chief+ / Parliament+)
- `GET /api/admin/shop/items` — full catalogue
- `POST /api/admin/shop/items` — create item (Parliament+)
- `PUT /api/admin/shop/items/<id>` — edit item (Parliament+)
- `DELETE /api/admin/shop/items/<id>` — delete item (Parliament+)
- `POST /api/admin/shop/items/reorder` — reorder catalogue (Parliament+)
- `POST /api/admin/shop/items/<id>/override` — toggle active / set stock
- `POST /api/admin/shop/items/upload-image` — upload item image (Parliament+)
- `POST /api/admin/shop/auctions/start` — start an auction
- `POST /api/admin/shop/auctions/<id>/extend` — adjust end time
- `POST /api/admin/shop/auctions/<id>/close` — cancel auction
- `POST /api/admin/shop/bids/<id>/remove` — remove a bid
- `GET /api/admin/shop/queue` — pending purchases + donations
- `POST /api/admin/shop/queue/fulfill` — fulfill a ticket
- `POST /api/admin/shop/queue/reject` — reject a ticket
