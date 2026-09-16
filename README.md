# PlayChest

> **A self-hosted fork of [EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache).**
> The original project targeted GitHub Pages; this fork runs in Docker and is named PlayChest.

Features land whenever they are ready and tested (there is no fixed release cadence). Check the [roadmap](#roadmap) for what is already available and what is coming next.

Build a searchable, filterable site for your BoardGameGeek collection: download games from BGG, generate a local SQLite database, and serve it with Docker.

![Site preview](gamecache-preview.png)

## Roadmap

### Done

- [x] Docker deploy (no GitHub Pages required)
- [x] Local database served by nginx
- [x] Automatic and manual sync from admin
- [x] Random game picker
- [x] Shareable URLs with filters and sort
- [x] Collection statistics dashboard
- [x] “Never played” filter
- [x] BGG status filters (owned, wishlist, want to play, …)
- [x] Multi-collection (several BGG accounts)
- [x] Grid / list / compact views
- [x] Personal notes and custom tags
- [x] Health endpoints and admin page (`/admin.html`)
- [x] Dark theme
- [x] PWA / offline browsing
- [x] Side-by-side game comparison
- [x] Saved nights (named filter presets)
- [x] Expansions grouped under the base game
- [x] Both of us picker

### Coming next

- [ ] Filters by publisher, designer, and year
- [ ] CSV/JSON export of the filtered collection
- [ ] Sync-complete notifications (webhook / Telegram)
- [ ] HTTPS-ready reverse proxy (Caddy/Traefik)

### Ideas under consideration

- [ ] Read-only REST API over the database
- [ ] Shelf location / price paid on game cards
- [ ] “Not played in X months” (using BGG play dates)
- [ ] Basic authentication (LAN/internet protection)

## Quick start

- [ ] Edit `config.ini` with your BGG username and site title
- [ ] Generate a BGG token: `python scripts/setup_bgg_token.py`
- [ ] Start Docker: `docker compose up --build`
- [ ] Open the site: [http://localhost:8080](http://localhost:8080)
- [ ] Admin sync: [http://localhost:8080/admin.html](http://localhost:8080/admin.html)

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [BoardGameGeek](https://boardgamegeek.com) account (free)
- For local development without Docker: Python 3.8–3.12

> BGG requires an API token. Run `python scripts/setup_bgg_token.py` to generate it.

## Docker setup

1. **Configure the project**

   ```ini
   title = "My collection"
   bgg_username = your_bgg_username
   ```

2. **BGG token**

   ```bash
   python scripts/setup_bgg_token.py
   ```

   This creates a local `.env` file with `GAMECACHE_BGG_TOKEN`. Add `GAMECACHE_ADMIN_PASSWORD` there as well; the admin page will not open without it.

3. **Build and start**

   ```bash
   docker compose up --build
   ```

   On first start the container downloads the collection from BGG and creates `gamecache.sqlite.gz`. This can take several minutes.

4. **Open the site**

   [http://localhost:8080](http://localhost:8080)

### Automatic updates

By default the database refreshes every hour. To change the interval (in seconds):

```bash
GAMECACHE_UPDATE_INTERVAL=7200 docker compose up --build
```

Set `0` to disable scheduled updates.

## Current features

- Random game picker
- Shareable URLs (search, filters, sort, view)
- Collection statistics and a “never played” shortcut
- BGG status filters and multi-collection
- Grid, list, and compact views
- Personal notes and tags via `/api/notes`
- Dark theme (manual toggle, with system preference as the default)
- Installable PWA with offline browsing of the cached collection
- Side-by-side game comparison
- Saved nights and expansion grouping
- Both of us picker
- Admin and health checks

### Both of us

Two players take turns on games that match the current filters. Heart keeps it in the pool, Veto removes it. When one game remains, that is the pick. Names come from the imported BGG collections when two owners exist.

### Saved nights

Open **Night** in the toolbar, name the current filters, and save. Apply a night later to restore that search, player count, weight, and the rest. Example names: “2 players”, “fillers”, “heavy weekend”. Nights are stored in the browser and on the server (`/api/nights`).

### Expansions

Owned expansions sit under their base game instead of appearing as separate covers. Household collections merge expansions even when different people own the base and the expansion. Search still finds an expansion by name and highlights the parent. Expansions without an owned parent stay in the box list of a related game when possible and are not shown as their own cards.

### Multi-collection

```ini
bgg_username = alice
bgg_username_2 = bob
```

Or:

```ini
bgg_usernames = alice, bob
```

You can also add or remove BGG usernames from `/admin.html` without restarting Docker. The admin page asks for a password. Set `GAMECACHE_ADMIN_PASSWORD` in `.env` and restart Docker. Remove runs a sync so those games leave the site. Usernames listed in `config.ini` stay in the file; Admin skips them until you add them again. The **Collection** filter appears when more than one owner is imported.

### Dark theme

Use the sun/moon button in the toolbar. The choice is stored in the browser. If you have never picked a theme, PlayChest follows `prefers-color-scheme`.

### PWA / offline

The site can be installed as an app (Add to Home Screen / Install). After the first successful load it caches:

- The app shell (HTML, CSS, JS, wasm)
- The SQLite collection database
- Game cover images as you browse (and prefetches them in the background)

You can then open and filter the collection without a network connection. Sync, notes upload, nights, and BGG links still need connectivity.

### Admin and health

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness |
| `GET /ready` | Database ready |
| `POST /api/admin/login` | Admin login (sets a session cookie) |
| `POST /api/admin/logout` | Admin logout |
| `GET /api/admin/session` | Admin session status |
| `POST /api/sync` | Manual sync (admin session) |
| `GET`/`POST`/`DELETE /api/usernames` | Collection usernames (admin session) |
| `GET`/`PUT /api/nights` | Saved nights |
| `/admin.html` | Admin UI (password protected) |

## Local development (without Docker)

```bash
pip install -r scripts/requirements.txt
python scripts/validate_setup.py
python scripts/download_and_index.py --cache_bgg
python -m http.server 8080
```

## Troubleshooting

**The site stays on “Loading database...”**
- Wait for the first sync and check the container logs
- Or run `python scripts/download_and_index.py --cache_bgg`

**BGG token errors**
- Re-run `python scripts/setup_bgg_token.py`
- Confirm `.env` contains `GAMECACHE_BGG_TOKEN`

**Admin page asks for a password**
- Add `GAMECACHE_ADMIN_PASSWORD` to `.env` and restart with `docker compose up --build`

**No games imported**
- Check `bgg_username` in `config.ini`
- The BGG collection must be public, with games marked as owned

**Check the site**

```bash
python scripts/check_website.py --url http://localhost:8080
```

## Original project

This fork starts from **[EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache)**.
Thanks to the original maintainer for the project foundation and BoardGameGeek integration.

## Credits

- Meeple icon (CC4 Attribution): https://icon-icons.com/icon/meeple/38522#256
- BoardGameGeek API for game data
- sql.js and fflate, vendored so the collection can be queried offline
- Upstream project: [EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache)
