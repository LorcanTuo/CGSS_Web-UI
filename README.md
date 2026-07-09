# Tournament Scoreboard

Mobile-friendly live leaderboard for a predictions competition.
Predictions and match results are edited directly in the site (protected by an admin
password) and stored in a JSON file that persists on a Docker volume.

## Run locally

Requires Node.js 20+.

```bash
npm test              # run scoring + store tests
ADMIN_PASSWORD=secret DATA_FILE=./data/scoreboard.json COOKIE_SECURE=false npm start
```

Open `http://localhost:8080`. On first run the data file is seeded from
`server/seed/scoreboard.json`.

## Run with Docker (Unraid)

```bash
ADMIN_PASSWORD='your-strong-password' \
SESSION_SECRET='a-long-random-string' \
docker compose up -d --build
```

- The container listens on port `8080` and stores data in the named volume
  `scoreboard-data` (mounted at `/data`).
- Point your **Cloudflare Tunnel** at `http://<unraid-ip>:8080`. Cloudflare provides
  the HTTPS/SSL, so leave `COOKIE_SECURE=true` (the default).

### Environment variables

| Variable           | Purpose                                             | Default                      |
| ------------------ | --------------------------------------------------- | ---------------------------- |
| `TOURNAMENT_NAME`  | Display name shown in the page title and header.    | `Tournament Scoreboard`      |
| `ADMIN_PASSWORD`   | Password to unlock in-site editing. **Set this.**   | _(empty = editing disabled)_ |
| `SESSION_SECRET`   | Secret used to sign the admin session cookie.       | dev fallback (change it)     |
| `COOKIE_SECURE`    | Set `false` only for plain-HTTP local testing.      | `true`                       |
| `PORT`             | Port the server listens on.                         | `8080`                       |
| `DATA_FILE`        | Path to the persisted JSON data file.               | `/data/scoreboard.json`      |
| `FOOTBALL_API_KEY` | API-Football key to enable automatic live scores. Leave empty to disable. | _(empty = disabled)_ |
| `FOOTBALL_SEASON`  | Season for API-Football fixtures.                   | `2026`                       |

## Editing in the site

1. Tap **Admin** (top of the page) and enter the admin password.
2. Edit **match results** (score, status, goalscorers) and each **player's
   predictions** (home/away score + goalscorer) and **predicted finalists**.
   Because predictions aren't revealed until match day, you can enter them here as
   they come in.
3. Tap **Save changes** — the leaderboard updates instantly and the data is written
   to the volume.

The public view is read-only; only someone with the admin password can edit.

## Live score updates (optional)

Set `FOOTBALL_API_KEY` to automatically pull scores and goalscorers from
[API-Football](https://www.api-sports.io/). **A paid plan is required for the
2026 World Cup season** (the free tier only allows seasons 2022–2024).

How it works:

1. In **Admin**, click **Import knockout fixtures** to add the upcoming
   quarter-final → final matches (teams, kickoff times, and the API fixture link).
   Review and **Save changes**.
2. Enter each player's predictions for those matches as normal.
3. While a linked match is in play, the server polls the API every 60 seconds and
   updates the score, status, and goalscorers automatically. You can also click
   **Sync now** to pull immediately.

Only matches with an API fixture link are touched by the poller — any match you
add manually (without a link) is left alone. **Predictions are always entered by
hand.** Scoring uses **normal time only** (0–90 + stoppage time); extra time and
penalty shootouts never count.

## Importing the spreadsheet

You can seed data from the shared spreadsheet by writing it into the data file
in this shape:

- `matches[].actual.home` / `matches[].actual.away` — current score (or `null`).
- `matches[].status` — `scheduled`, `live`, or `final`.
- `matches[].goalscorers` — `[{ name, team, goals }]` for the match.
- `players[].predictions[matchId]` — `{ home, away, goalscorer }`.
- `players[].predictedFinalists` — the predicted finalists.
- `actualFinalists` — real finalists, once known.

## Scoring

- Correct winner: **5 points**.
- Correct scoreline: **2 points** plus **1 point per goal** scored.
- Correct 0-0 scoreline: **1 additional point**.
- Selected goalscorer: **3 points per goal** plus **2 bonus points** for a hat-trick or more.
- Predicted finalists: **5 points per correct finalist**.

## Backups

All state lives in the `scoreboard-data` volume. To back up:

```bash
docker run --rm -v scoreboard-data:/data -v "$PWD":/backup alpine \
  cp /data/scoreboard.json /backup/scoreboard-backup.json
```
