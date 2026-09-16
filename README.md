# GameCache - View and filter your boardgame collection

Create a beautiful, searchable website for your BoardGameGeek collection. GameCache downloads your games from BoardGameGeek, builds a local SQLite database, and serves the site with Docker.

![Site preview](gamecache-preview.png)

**What you'll get:**
- A searchable website based on your board game collection from BoardGameGeek
- Automatic filtering by players, time, weight, categories, and more
- Rich game details from BoardGameGeek (ratings, descriptions, mechanics, and more)
- Self-hosted deployment with Docker

## Quick Start Checklist

- [ ] **Edit config.ini** with your BGG username and site title
- [ ] **Get BGG token**: `python scripts/setup_bgg_token.py`
- [ ] **Start with Docker**: `docker compose up --build`
- [ ] **Visit your site**: `http://localhost:8080`

## Requirements

* [Docker](https://docs.docker.com/get-docker/) and Docker Compose
* [BoardGameGeek](https://boardgamegeek.com) account (free)
* For local development without Docker: Python 3.8-3.12

> **Note about BGG tokens**: BGG requires API tokens. Run `python scripts/setup_bgg_token.py` to generate one.

## Docker Setup

1. **Configure the project**

   Edit `config.ini`:

   ```ini
   title = "John's boardgames"
   bgg_username = johnsmith
   ```

2. **Create your BGG token**

   ```bash
   python scripts/setup_bgg_token.py
   ```

   This creates a local `.env` file with `GAMECACHE_BGG_TOKEN`.

3. **Build and run**

   ```bash
   docker compose up --build
   ```

   On first start, the container downloads your collection from BoardGameGeek and builds `gamecache.sqlite.gz`. This can take several minutes depending on collection size.

4. **Open the site**

   Visit [http://localhost:8080](http://localhost:8080)

### Automatic updates

By default, Docker Compose refreshes the database every hour. To change the interval, set `GAMECACHE_UPDATE_INTERVAL` in seconds:

```bash
GAMECACHE_UPDATE_INTERVAL=7200 docker compose up --build
```

Set it to `0` to disable scheduled updates.

### Docker files

| File | Purpose |
|------|---------|
| `Dockerfile` | Python indexer + nginx web server |
| `docker-compose.yml` | Local deployment with persistent database volume |
| `docker/nginx.conf` | Static site and database serving |
| `docker/entrypoint.sh` | Initial sync, scheduled refresh, startup |

## Local Development (without Docker)

1. Install dependencies:

   ```bash
   pip install -r scripts/requirements.txt
   ```

2. Validate setup:

   ```bash
   python scripts/validate_setup.py
   ```

3. Build the database:

   ```bash
   python scripts/download_and_index.py --cache_bgg
   ```

4. Serve the site:

   ```bash
   python -m http.server 8080
   ```

5. Open [http://localhost:8080](http://localhost:8080)

## Features

- Random game picker and a "What should we play tonight?" wizard
- Shareable URLs that preserve search, filters, sort order, and view mode
- Collection statistics dashboard with never-played shortcut
- BGG status filters (owned, wishlist, want to play, and more)
- Multi-collection support via multiple BGG usernames in `config.ini`
- Grid, list, and compact view modes
- Personal notes and custom tags stored in `/api/notes`
- Admin page at `/admin.html` with manual sync and health endpoints

### Multi-collection config

```ini
bgg_username = alice
bgg_username_2 = bob
```

Or:

```ini
bgg_usernames = alice, bob
```

### Admin and health

- Health: `GET /health`
- Ready: `GET /ready`
- Status: `GET /api/status`
- Manual sync: `POST /api/sync`
- Admin UI: [http://localhost:8080/admin.html](http://localhost:8080/admin.html)

## Configuration

`config.ini` supports:

```ini
title = "Your site title"
bgg_username = your_bgg_username
```

Optional legacy GitHub upload settings:

```ini
github_repo = owner/repo
```

If you add `github_repo`, you can upload the database to GitHub Releases with:

```bash
python scripts/download_and_index.py --upload --cache_bgg
```

## Troubleshooting

**Website shows "Loading database..." forever**
- Wait for the first Docker sync to finish and check container logs
- Or run `python scripts/download_and_index.py --cache_bgg` locally

**BGG token errors**
- Run `python scripts/setup_bgg_token.py` again
- Ensure `.env` contains `GAMECACHE_BGG_TOKEN=...`

**No games imported**
- Verify your BGG username in `config.ini`
- Make sure your BGG collection is public and games are marked as owned

**Check the running site**

```bash
python scripts/check_website.py --url http://localhost:8080
```

## Updating your database manually

```bash
python scripts/download_and_index.py --cache_bgg
```

With Docker running, restart the container or wait for the next scheduled refresh.

## Credits

* Meeple icon (CC4 Attribution): https://icon-icons.com/icon/meeple/38522#256
* BoardGameGeek API for game data
* Mobile testing with: <a href="https://www.browserstack.com"><img src="https://raw.githubusercontent.com/EmilStenstrom/gamecache/master/Browserstack-logo@2x.png" height="25" alt="Browserstack" style="vertical-align: top"></a>
