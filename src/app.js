import { calculateLeaderboard } from "./scoring.js";

const DATA_URL = "/api/data";
const SESSION_URL = "/api/session";

const elements = {
  lastUpdated: document.querySelector("#last-updated"),
  playerCount: document.querySelector("#player-count"),
  leaderboardBody: document.querySelector("#leaderboard-body"),
  heading: document.querySelector("#tournament-name"),
  eyebrow: document.querySelector("#tournament-eyebrow")
};

function setText(element, value) {
  element.textContent = value;
}

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-IE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function createCell(label, value, modifier) {
  const cell = document.createElement("div");
  cell.className = "board__cell";
  if (modifier) {
    cell.classList.add(`board__cell--${modifier}`);
  }
  cell.dataset.label = label;

  const valueEl = document.createElement("span");
  valueEl.className = "board__value";
  if (value && typeof value === "object" && "nodeType" in value) {
    valueEl.append(value);
  } else {
    valueEl.textContent = value;
  }
  cell.append(valueEl);
  return cell;
}

function createPreviousCell(player) {
  const wrap = document.createElement("span");
  wrap.className = "board__prev";

  if (typeof player.previousRank !== "number") {
    wrap.textContent = "–";
    return wrap;
  }

  const number = document.createElement("span");
  number.textContent = `#${player.previousRank}`;
  wrap.append(number);

  if (typeof player.move === "number" && player.move !== 0) {
    const move = document.createElement("span");
    const up = player.move > 0;
    move.className = `board__move board__move--${up ? "up" : "down"}`;
    move.textContent = `${up ? "▲" : "▼"}${Math.abs(player.move)}`;
    wrap.append(move);
  }

  return wrap;
}

// Stage display order for the breakdown panel.
const STAGE_ORDER = ["Quarter-finals", "Semi-finals", "Final"];

function normaliseStage(stage) {
  const s = String(stage ?? "").trim();
  if (/quarter/i.test(s)) return "Quarter-finals";
  if (/semi/i.test(s)) return "Semi-finals";
  // Lump "3rd Place Final" in with "Final"
  if (/final/i.test(s)) return "Final";
  return s || "Knockout";
}

function createBreakdown(player, matchNames, matchStages) {
  const wrap = document.createElement("div");
  wrap.className = "board__breakdown";
  wrap.hidden = true;

  const b = player.baseline ?? {};

  // Sum match points per normalised stage.
  const stageTotals = new Map();
  for (const match of player.matchBreakdown) {
    const stage = normaliseStage(matchStages.get(match.matchId));
    stageTotals.set(stage, (stageTotals.get(stage) ?? 0) + match.total);
  }
  const stageRows = STAGE_ORDER
    .filter((s) => stageTotals.has(s))
    .map((s) => [s, stageTotals.get(s)]);
  // Any unexpected stage names fall at the end.
  for (const [s, v] of stageTotals) {
    if (!STAGE_ORDER.includes(s)) stageRows.push([s, v]);
  }

  const totals = document.createElement("div");
  totals.className = "breakdown-totals";
  const categories = [
    ["Matchday 1", b.matchday1 ?? 0],
    ["Matchday 2", b.matchday2 ?? 0],
    ["Matchday 3", b.matchday3 ?? 0],
    ["Group total", b.groupTotal ?? 0],
    ["Round of 32", b.r32 ?? 0],
    ["Round of 16", b.r16 ?? 0],
    ...stageRows,
    ["Goalscorer pts", b.goalscorerPoints ?? 0]
  ];
  for (const [label, value] of categories) {
    const item = document.createElement("div");
    item.className = "breakdown-total";
    const name = document.createElement("span");
    name.textContent = label;
    const points = document.createElement("strong");
    points.textContent = `${value} pts`;
    item.append(name, points);
    totals.append(item);
  }
  wrap.append(totals);

  const scorers = document.createElement("p");
  scorers.className = "breakdown-scorers";
  const group = player.designatedGoalscorerGroup || "—";
  const knockout = player.designatedGoalscorerKnockout || "—";
  scorers.innerHTML =
    `<span>Group scorer: <strong>${group}</strong></span>` +
    `<span>Knockout scorer: <strong>${knockout}</strong></span>`;
  wrap.append(scorers);

  const scoring = player.matchBreakdown.filter((match) => match.total > 0);
  if (scoring.length) {
    const list = document.createElement("ul");
    list.className = "breakdown-matches";
    for (const match of scoring) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = matchNames.get(match.matchId) ?? match.matchId;
      const points = document.createElement("strong");
      points.textContent = `${match.total} pts`;
      item.append(name, points);
      list.append(item);
    }
    wrap.append(list);
  }

  return wrap;
}

const expandedPlayers = new Set();

function renderLeaderboard(data) {
  const leaderboard = calculateLeaderboard(data);
  const matchNames = new Map(
    (data.matches ?? []).map((match) => [match.id, `${match.homeTeam} v ${match.awayTeam}`])
  );
  const matchStages = new Map(
    (data.matches ?? []).map((match) => [match.id, match.stage ?? ""])
  );

  setText(elements.playerCount, `${leaderboard.length} players`);
  setText(elements.lastUpdated, formatDate(data.lastUpdated));

  elements.leaderboardBody.replaceChildren(
    ...leaderboard.map((player) => {
      const row = document.createElement("div");
      row.className = "board__row";
      if (player.rank === 1) {
        row.classList.add("leader");
      }

      const isOpen = expandedPlayers.has(player.name);

      const summary = document.createElement("button");
      summary.type = "button";
      summary.className = "board__summary";
      summary.setAttribute("aria-expanded", String(isOpen));

      summary.append(
        createCell("Position", `#${player.rank}`, "pos"),
        createCell("Previous", createPreviousCell(player), "prev"),
        createCell("Name", player.name || "—", "name"),
        createCell(
          "Final prediction",
          player.finalPrediction ||
            (player.predictedFinalists.length ? player.predictedFinalists.join(" v ") : "—"),
          "finalists"
        ),
        createCell(
          "Designated goalscorer",
          player.designatedGoalscorerKnockout || player.designatedGoalscorerGroup || "—",
          "scorer"
        ),
        createCell("Overall", player.total, "score")
      );

      const breakdown = createBreakdown(player, matchNames, matchStages);
      breakdown.hidden = !isOpen;
      row.classList.toggle("is-open", isOpen);

      summary.addEventListener("click", () => {
        const open = breakdown.hidden;
        breakdown.hidden = !open;
        summary.setAttribute("aria-expanded", String(open));
        row.classList.toggle("is-open", open);
        if (open) {
          expandedPlayers.add(player.name);
        } else {
          expandedPlayers.delete(player.name);
        }
      });

      row.append(summary, breakdown);
      return row;
    })
  );
}

function renderError() {
  const template = document.querySelector("#empty-state-template");
  document.querySelector("main").replaceChildren(template.content.cloneNode(true));
  setText(elements.lastUpdated, "Data error");
}

let renderedOnce = false;

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load scoreboard data: ${response.status}`);
    }

    const data = await response.json();
    renderLeaderboard(data);
    renderedOnce = true;
  } catch (error) {
    console.error(error);
    if (!renderedOnce) {
      renderError();
    }
  }
}

const REFRESH_INTERVAL_MS = 20000;
let refreshTimer = null;

function startAutoRefresh() {
  if (refreshTimer !== null) {
    return;
  }
  refreshTimer = setInterval(() => {
    if (!document.hidden) {
      init();
    }
  }, REFRESH_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    init();
  }
});

async function applyTournamentName() {
  try {
    const res = await fetch(SESSION_URL, { cache: "no-store" });
    const session = await res.json();
    if (session.tournamentName) {
      document.title = session.tournamentName;
      if (elements.heading) setText(elements.heading, session.tournamentName);
    }
  } catch {
    // Non-critical — page title stays as default
  }
}

init();
applyTournamentName();
startAutoRefresh();

document.addEventListener("scoreboard:refresh", init);
