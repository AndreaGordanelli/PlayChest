# GameCache — Fork personale

> **Questo repository è un fork di [EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache).**  
> Il progetto originale era pensato per GitHub Pages; questo fork lo rende **self-hosted con Docker** e aggiunge nuove funzionalità in modo incrementale.

Le feature vengono aggiunte **ogni tot** (non c’è un rilascio fisso: quando una modifica è pronta e testata, viene integrata qui). Controlla la [roadmap](#roadmap) per vedere cosa c’è già e cosa arriva dopo.

Crea un sito consultabile e filtrabile per la tua collezione BoardGameGeek: scarica i giochi da BGG, genera un database SQLite locale e servilo con Docker.

![Site preview](gamecache-preview.png)

## Roadmap

### Completato

- [x] Deploy con Docker (senza GitHub Pages)
- [x] Database locale servito da nginx
- [x] Sync automatico e manuale da admin
- [x] Game picker casuale
- [x] Wizard “Stasera cosa giochiamo?”
- [x] URL condivisibili con filtri e ordinamento
- [x] Dashboard statistiche collezione
- [x] Filtro “mai giocati”
- [x] Filtri stato BGG (owned, wishlist, want to play, …)
- [x] Multi-collezione (più account BGG)
- [x] Vista griglia / lista / compatta
- [x] Note personali e tag custom
- [x] Endpoint health e pagina admin (`/admin.html`)

### In arrivo (prossimi aggiornamenti)

- [ ] Tema scuro
- [ ] PWA / consultazione offline
- [ ] Filtri per editore, designer e anno
- [ ] Confronto side-by-side tra giochi
- [ ] Export CSV/JSON della collezione filtrata
- [ ] Notifiche al termine del sync (webhook / Telegram)
- [ ] HTTPS pronto con reverse proxy (Caddy/Traefik)

### Idee in valutazione

- [ ] API REST read-only sul database
- [ ] Schede con posizione scaffale / prezzo pagato
- [ ] “Non giocato da X mesi” (con date partite BGG)
- [ ] Supporto autenticazione base (protezione LAN/internet)

## Avvio rapido

- [ ] Modifica `config.ini` con username BGG e titolo sito
- [ ] Genera token BGG: `python scripts/setup_bgg_token.py`
- [ ] Avvia Docker: `docker compose up --build`
- [ ] Apri il sito: [http://localhost:8080](http://localhost:8080)
- [ ] Admin sync: [http://localhost:8080/admin.html](http://localhost:8080/admin.html)

## Requisiti

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose
- Account [BoardGameGeek](https://boardgamegeek.com) (gratuito)
- Per sviluppo locale senza Docker: Python 3.8–3.12

> BGG richiede un token API. Esegui `python scripts/setup_bgg_token.py` per generarlo.

## Setup Docker

1. **Configura il progetto**

   ```ini
   title = "La mia collezione"
   bgg_username = tuo_username_bgg
   ```

2. **Token BGG**

   ```bash
   python scripts/setup_bgg_token.py
   ```

   Crea il file locale `.env` con `GAMECACHE_BGG_TOKEN`.

3. **Build e avvio**

   ```bash
   docker compose up --build
   ```

   Al primo avvio il container scarica la collezione da BGG e crea `gamecache.sqlite.gz`. Può richiedere diversi minuti.

4. **Apri il sito**

   [http://localhost:8080](http://localhost:8080)

### Aggiornamenti automatici

Di default il database si aggiorna ogni ora. Per cambiare l’intervallo (in secondi):

```bash
GAMECACHE_UPDATE_INTERVAL=7200 docker compose up --build
```

Imposta `0` per disabilitare gli aggiornamenti programmati.

## Funzionalità attuali

- Game picker casuale e wizard “Stasera cosa giochiamo?”
- URL condivisibili (ricerca, filtri, ordinamento, vista)
- Statistiche collezione e scorciatoia “mai giocati”
- Filtri stato BGG e multi-collezione
- Viste griglia, lista e compatta
- Note personali e tag via `/api/notes`
- Admin e health check

### Multi-collezione

```ini
bgg_username = alice
bgg_username_2 = bob
```

Oppure:

```ini
bgg_usernames = alice, bob
```

### Admin e health

| Endpoint | Descrizione |
|----------|-------------|
| `GET /health` | Liveness |
| `GET /ready` | Database pronto |
| `GET /api/status` | Stato sync |
| `POST /api/sync` | Sync manuale |
| `/admin.html` | Interfaccia admin |

## Sviluppo locale (senza Docker)

```bash
pip install -r scripts/requirements.txt
python scripts/validate_setup.py
python scripts/download_and_index.py --cache_bgg
python -m http.server 8080
```

## Troubleshooting

**Il sito resta su “Loading database...”**
- Attendi il primo sync e controlla i log del container
- Oppure esegui `python scripts/download_and_index.py --cache_bgg`

**Errori token BGG**
- Riesegui `python scripts/setup_bgg_token.py`
- Verifica che `.env` contenga `GAMECACHE_BGG_TOKEN`

**Nessun gioco importato**
- Controlla `bgg_username` in `config.ini`
- La collezione BGG deve essere pubblica con giochi segnati come posseduti

**Verifica sito**

```bash
python scripts/check_website.py --url http://localhost:8080
```

## Progetto originale

Questo fork parte da **[EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache)**.  
Ringraziamenti al maintainer originale per la base del progetto e l’integrazione con BoardGameGeek.

## Crediti

- Meeple icon (CC4 Attribution): https://icon-icons.com/icon/meeple/38522#256
- BoardGameGeek API per i dati dei giochi
- Progetto upstream: [EmilStenstrom/gamecache](https://github.com/EmilStenstrom/gamecache)
