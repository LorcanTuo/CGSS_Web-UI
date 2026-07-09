import { FootballApi } from "./football-api.js";

// Poll frequently while a match is in play, slowly otherwise, to respect
// the daily request budget.
const ACTIVE_INTERVAL_MS = 60_000; // 1 min when a linked match is live
const IDLE_INTERVAL_MS = 15 * 60_000; // 15 min otherwise
// Start polling a fixture from this long before its kick-off.
const PREKICKOFF_WINDOW_MS = 15 * 60_000;

function shouldTrack(match, now) {
  if (!match.apiFixtureId) {
    return false;
  }
  if (match.status === "final") {
    return false;
  }
  if (match.status === "live") {
    return true;
  }
  // scheduled: only near/after kick-off.
  const kickoff = Date.parse(match.kickoff);
  if (!Number.isFinite(kickoff)) {
    return true; // unknown kickoff -> keep an eye on it
  }
  return now >= kickoff - PREKICKOFF_WINDOW_MS;
}

function mergeResult(match, result) {
  let changed = false;
  const next = { ...match };

  if (result.status && result.status !== match.status) {
    next.status = result.status;
    changed = true;
  }

  const home = result.actual?.home ?? null;
  const away = result.actual?.away ?? null;
  if (home !== match.actual?.home || away !== match.actual?.away) {
    next.actual = { home, away };
    changed = true;
  }

  const nextScorers = result.goalscorers ?? [];
  if (JSON.stringify(nextScorers) !== JSON.stringify(match.goalscorers ?? [])) {
    next.goalscorers = nextScorers;
    changed = true;
  }

  return { next, changed };
}

export class FootballPoller {
  constructor(store, apiKey, { logger = console } = {}) {
    this.store = store;
    this.api = new FootballApi(apiKey);
    this.logger = logger;
    this.timer = null;
    this.running = false;
  }

  get enabled() {
    return this.api.enabled;
  }

  start() {
    if (!this.enabled || this.timer) {
      return;
    }
    this.logger.log("Football poller enabled.");
    this.scheduleNext(5_000);
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleNext(delay) {
    this.timer = setTimeout(() => this.tick(), delay);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  async tick() {
    let anyLive = false;
    try {
      anyLive = await this.syncOnce();
    } catch (error) {
      this.logger.error("Poller tick failed:", error.message);
    } finally {
      this.scheduleNext(anyLive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
    }
  }

  // Returns true if at least one tracked match is currently live.
  async syncOnce() {
    if (this.running) {
      return false;
    }
    this.running = true;

    try {
      const data = await this.store.load();
      const now = Date.now();
      const tracked = (data.matches ?? []).filter((m) => shouldTrack(m, now));

      if (!tracked.length) {
        return false;
      }

      let mutated = false;
      let anyLive = false;

      for (const match of tracked) {
        try {
          const result = await this.api.fetchResult(match.apiFixtureId);
          const index = data.matches.findIndex((m) => m.id === match.id);
          if (index < 0) {
            continue;
          }
          const { next, changed } = mergeResult(data.matches[index], result);
          if (changed) {
            data.matches[index] = next;
            mutated = true;
            this.logger.log(
              `Updated ${next.homeTeam} v ${next.awayTeam}: ` +
                `${next.actual.home ?? "-"}-${next.actual.away ?? "-"} (${next.status})`
            );
          }
          if (next.status === "live") {
            anyLive = true;
          }
        } catch (error) {
          this.logger.error(`Fixture ${match.apiFixtureId} sync failed:`, error.message);
        }
      }

      if (mutated) {
        await this.store.save(data);
      }

      return anyLive;
    } finally {
      this.running = false;
    }
  }
}
