const API_BASE = "https://v3.football.api-sports.io";
const FOOTBALL_LEAGUE_ID = 1;

// API-Football status codes -> our internal status.
const FINISHED = new Set(["FT", "AET", "PEN"]);
const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"]);

function mapStatus(short) {
  if (FINISHED.has(short)) {
    return "final";
  }
  if (LIVE.has(short)) {
    return "live";
  }
  return "scheduled";
}

// Normalise the team-side team name from an event goal.
function isNormalTimeGoal(event) {
  // Only count goals scored in normal time (0-90 + injury time).
  // API-Football reports injury time via time.extra while elapsed stays <= 90.
  // Extra time (91-120) and penalty shootouts must NOT count.
  if (event?.type !== "Goal") {
    return false;
  }
  const detail = String(event?.detail ?? "");
  // Missed penalties / shootout misses are Goal-type events but not goals.
  if (detail.toLowerCase().includes("missed")) {
    return false;
  }
  const elapsed = Number(event?.time?.elapsed);
  return Number.isFinite(elapsed) && elapsed <= 90;
}

// Build our goalscorer list (name -> goals) from events, normal time only.
// Own goals count toward the score but are NOT credited to the scorer.
export function goalscorersFromEvents(events = []) {
  const tally = new Map();

  for (const event of events) {
    if (!isNormalTimeGoal(event)) {
      continue;
    }
    const detail = String(event?.detail ?? "").toLowerCase();
    if (detail.includes("own")) {
      continue;
    }
    const name = String(event?.player?.name ?? "").trim();
    if (!name) {
      continue;
    }
    const team = String(event?.team?.name ?? "").trim();
    const key = `${name}::${team}`;
    const current = tally.get(key) ?? { name, team, goals: 0 };
    current.goals += 1;
    tally.set(key, current);
  }

  return [...tally.values()];
}

async function apiFetch(path, apiKey) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-apisports-key": apiKey }
  });

  if (!response.ok) {
    throw new Error(`API-Football request failed: ${response.status}`);
  }

  const body = await response.json();
  if (Array.isArray(body.errors) ? body.errors.length : Object.keys(body.errors ?? {}).length) {
    throw new Error(`API-Football error: ${JSON.stringify(body.errors)}`);
  }

  return body.response ?? [];
}

export class FootballApi {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  // List fixtures for a season, optionally filtered by round substring.
  async listFixtures(season, roundMatch = null) {
    const fixtures = await apiFetch(
      `/fixtures?league=${FOOTBALL_LEAGUE_ID}&season=${season}`,
      this.apiKey
    );

    return fixtures
      .filter((f) => {
        if (!roundMatch) {
          return true;
        }
        const round = String(f?.league?.round ?? "");
        return roundMatch.some((needle) => round.includes(needle));
      })
      .map((f) => ({
        apiFixtureId: f.fixture.id,
        stage: String(f.league?.round ?? "").trim(),
        kickoff: f.fixture?.date ?? "",
        homeTeam: f.teams?.home?.name ?? "",
        awayTeam: f.teams?.away?.name ?? "",
        status: mapStatus(f.fixture?.status?.short)
      }));
  }

  // Fetch a single fixture's normal-time result + goalscorers.
  async fetchResult(apiFixtureId) {
    const [fixtures, events] = await Promise.all([
      apiFetch(`/fixtures?id=${apiFixtureId}`, this.apiKey),
      apiFetch(`/fixtures/events?fixture=${apiFixtureId}`, this.apiKey)
    ]);

    const fixture = fixtures[0];
    if (!fixture) {
      throw new Error(`Fixture ${apiFixtureId} not found`);
    }

    const short = fixture.fixture?.status?.short;
    const status = mapStatus(short);

    // Use the score AFTER 90 minutes (normal time). For live matches
    // score.fulltime is null, so fall back to the running goals tally.
    const fulltime = fixture.score?.fulltime ?? {};
    const running = fixture.goals ?? {};
    const home = fulltime.home ?? running.home ?? null;
    const away = fulltime.away ?? running.away ?? null;

    return {
      apiFixtureId,
      status,
      homeTeam: fixture.teams?.home?.name ?? "",
      awayTeam: fixture.teams?.away?.name ?? "",
      kickoff: fixture.fixture?.date ?? "",
      actual: {
        home: Number.isFinite(Number(home)) ? Number(home) : null,
        away: Number.isFinite(Number(away)) ? Number(away) : null
      },
      goalscorers: goalscorersFromEvents(events)
    };
  }
}
