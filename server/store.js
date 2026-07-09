import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = join(here, "seed", "scoreboard.json");

const VALID_STATUSES = new Set(["scheduled", "live", "final"]);

function toGoals(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

function sanitiseGoalscorers(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((scorer) => {
      const name = String(scorer?.name ?? "").trim();
      const goals = Math.max(1, Math.floor(Number(scorer?.goals) || 1));
      const team = String(scorer?.team ?? "").trim();
      return name ? { name, team, goals } : null;
    })
    .filter(Boolean);
}

function sanitiseMatch(match, index) {
  const id = String(match?.id ?? `match-${index + 1}`).trim() || `match-${index + 1}`;
  const status = VALID_STATUSES.has(match?.status) ? match.status : "scheduled";
  const apiFixtureId = toGoals(match?.apiFixtureId);

  return {
    id,
    apiFixtureId,
    stage: String(match?.stage ?? "").trim(),
    kickoff: String(match?.kickoff ?? "").trim(),
    homeTeam: String(match?.homeTeam ?? "").trim(),
    awayTeam: String(match?.awayTeam ?? "").trim(),
    status,
    actual: {
      home: toGoals(match?.actual?.home),
      away: toGoals(match?.actual?.away)
    },
    goalscorers: sanitiseGoalscorers(match?.goalscorers)
  };
}

function sanitisePrediction(prediction) {
  return {
    home: toGoals(prediction?.home),
    away: toGoals(prediction?.away)
  };
}

const BASELINE_KEYS = [
  "matchday1",
  "matchday2",
  "matchday3",
  "groupTotal",
  "r32",
  "r16",
  "goalscorerPoints"
];

function toPoints(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed);
}

function sanitiseBaseline(baseline) {
  const clean = {};
  for (const key of BASELINE_KEYS) {
    clean[key] = toPoints(baseline?.[key]);
  }
  return clean;
}

function sanitisePlayer(player, matchIds) {
  const predictions = {};
  const source = player?.predictions ?? {};

  for (const matchId of matchIds) {
    if (source[matchId]) {
      predictions[matchId] = sanitisePrediction(source[matchId]);
    }
  }

  const predictedFinalists = Array.isArray(player?.predictedFinalists)
    ? player.predictedFinalists.map((team) => String(team ?? "").trim()).filter(Boolean)
    : [];

  const previousPosition = toGoals(player?.previousPosition);

  return {
    name: String(player?.name ?? "").trim(),
    previousPosition,
    finalPrediction: String(player?.finalPrediction ?? "").trim(),
    predictedFinalists,
    designatedGoalscorerGroup: String(player?.designatedGoalscorerGroup ?? "").trim(),
    designatedGoalscorerKnockout: String(player?.designatedGoalscorerKnockout ?? "").trim(),
    baseline: sanitiseBaseline(player?.baseline),
    predictions
  };
}

export function sanitiseData(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Scoreboard data must be an object");
  }

  if (!Array.isArray(input.matches)) {
    throw new Error("Scoreboard data must include a matches array");
  }

  if (!Array.isArray(input.players)) {
    throw new Error("Scoreboard data must include a players array");
  }

  const matches = input.matches.map(sanitiseMatch);
  const matchIds = matches.map((match) => match.id);

  const players = input.players
    .map((player) => sanitisePlayer(player, matchIds))
    .filter((player) => player.name);

  const actualFinalists = Array.isArray(input.actualFinalists)
    ? input.actualFinalists.map((team) => String(team ?? "").trim()).filter(Boolean)
    : [];

  return {
    lastUpdated: new Date().toISOString(),
    actualFinalists,
    matches,
    players
  };
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

export class ScoreboardStore {
  constructor(dataFile) {
    this.dataFile = dataFile;
  }

  async init() {
    await mkdir(dirname(this.dataFile), { recursive: true });

    if (!existsSync(this.dataFile)) {
      const seed = await readJson(SEED_FILE);
      await this.save(seed);
    }

    return this.load();
  }

  async load() {
    return readJson(this.dataFile);
  }

  async save(data) {
    const clean = sanitiseData(data);
    const tempFile = `${this.dataFile}.${process.pid}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
    await rename(tempFile, this.dataFile);
    return clean;
  }
}
