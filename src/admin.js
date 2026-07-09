const STATUSES = ["scheduled", "live", "final"];

const state = {
  admin: false,
  authRequired: true,
  footballApi: false,
  data: null
};

const refs = {
  toggle: document.querySelector("#admin-toggle"),
  panel: document.querySelector("#admin-panel"),
  login: document.querySelector("#admin-login"),
  loginForm: document.querySelector("#admin-login-form"),
  password: document.querySelector("#admin-password"),
  loginError: document.querySelector("#admin-login-error"),
  editor: document.querySelector("#admin-editor"),
  matches: document.querySelector("#admin-matches"),
  players: document.querySelector("#admin-players"),
  finalists: document.querySelector("#admin-finalists"),
  save: document.querySelector("#admin-save"),
  status: document.querySelector("#admin-status"),
  logout: document.querySelector("#admin-logout"),
  addPlayer: document.querySelector("#admin-add-player"),
  addMatch: document.querySelector("#admin-add-match"),
  apiActions: document.querySelector("#admin-api-actions"),
  importFixtures: document.querySelector("#admin-import-fixtures"),
  syncNow: document.querySelector("#admin-sync-now")
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseScoreSequence(text, matchCount) {
  const nums = (String(text).match(/\d+/g) || []).map(Number);
  const expected = matchCount * 2;
  if (nums.length !== expected) {
    return { ok: false, expected, found: nums.length, scores: [] };
  }
  const scores = [];
  for (let i = 0; i < matchCount; i += 1) {
    scores.push({ home: nums[i * 2], away: nums[i * 2 + 1] });
  }
  return { ok: true, expected, found: nums.length, scores };
}

function setStatus(message, kind = "info") {
  refs.status.textContent = message;
  refs.status.dataset.kind = kind;
}

function numberOrNull(value) {
  if (value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function field(labelText, control) {
  const label = document.createElement("label");
  label.className = "admin-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function numberInput(value, onChange, { min = 0 } = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.inputMode = "numeric";
  input.value = value ?? "";
  input.addEventListener("input", () => onChange(numberOrNull(input.value)));
  return input;
}

function textInput(value, onChange, placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function renderMatchEditor(match) {
  const card = document.createElement("article");
  card.className = "admin-card";

  const header = document.createElement("div");
  header.className = "admin-card__header";

  const title = document.createElement("h4");
  title.textContent =
    `${match.homeTeam || "Home"} v ${match.awayTeam || "Away"}`.trim();
  header.append(title);

  const removeMatch = document.createElement("button");
  removeMatch.type = "button";
  removeMatch.className = "admin-remove";
  removeMatch.textContent = "Remove match";
  removeMatch.addEventListener("click", () => {
    const index = state.data.matches.indexOf(match);
    if (index >= 0) {
      state.data.matches.splice(index, 1);
      renderEditor();
    }
  });
  header.append(removeMatch);
  card.append(header);

  const teams = document.createElement("div");
  teams.className = "admin-grid";
  teams.append(
    field(
      "Home team",
      textInput(match.homeTeam, (v) => {
        match.homeTeam = v;
        title.textContent = `${match.homeTeam || "Home"} v ${match.awayTeam || "Away"}`;
      }, "Home team")
    ),
    field(
      "Away team",
      textInput(match.awayTeam, (v) => {
        match.awayTeam = v;
        title.textContent = `${match.homeTeam || "Home"} v ${match.awayTeam || "Away"}`;
      }, "Away team")
    ),
    field(
      "Stage",
      textInput(match.stage, (v) => (match.stage = v), "e.g. Quarter-final")
    ),
    field(
      "Kick-off",
      textInput(match.kickoff, (v) => (match.kickoff = v), "e.g. 2026-07-09 20:00")
    )
  );
  card.append(teams);

  if (state.footballApi) {
    const apiRow = document.createElement("div");
    apiRow.className = "admin-grid";
    apiRow.append(
      field(
        "API fixture ID (auto-updates)",
        numberInput(
          match.apiFixtureId ?? "",
          (v) => (match.apiFixtureId = v),
          { min: 0 }
        )
      )
    );
    card.append(apiRow);
  }

  const grid = document.createElement("div");
  grid.className = "admin-grid";

  grid.append(
    field("Home goals", numberInput(match.actual.home, (v) => (match.actual.home = v))),
    field("Away goals", numberInput(match.actual.away, (v) => (match.actual.away = v)))
  );

  const statusSelect = document.createElement("select");
  for (const option of STATUSES) {
    const el = document.createElement("option");
    el.value = option;
    el.textContent = option;
    el.selected = option === match.status;
    statusSelect.append(el);
  }
  statusSelect.addEventListener("change", () => (match.status = statusSelect.value));
  grid.append(field("Status", statusSelect));
  card.append(grid);

  const scorersTitle = document.createElement("p");
  scorersTitle.className = "admin-subtitle";
  scorersTitle.textContent = "Goalscorers";
  card.append(scorersTitle);

  const scorerList = document.createElement("div");
  scorerList.className = "admin-scorers";
  card.append(scorerList);

  const renderScorers = () => {
    scorerList.replaceChildren(
      ...match.goalscorers.map((scorer, index) => {
        const row = document.createElement("div");
        row.className = "admin-scorer";

        row.append(
          textInput(scorer.name, (v) => (scorer.name = v), "Player name"),
          numberInput(scorer.goals, (v) => (scorer.goals = v ?? 1), { min: 1 })
        );

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "admin-remove";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          match.goalscorers.splice(index, 1);
          renderScorers();
        });
        row.append(remove);
        return row;
      })
    );
  };

  const addScorer = document.createElement("button");
  addScorer.type = "button";
  addScorer.className = "admin-add";
  addScorer.textContent = "Add goalscorer";
  addScorer.addEventListener("click", () => {
    match.goalscorers.push({ name: "", team: "", goals: 1 });
    renderScorers();
  });

  renderScorers();
  card.append(addScorer);
  return card;
}

function renderPlayerEditor(player, matches) {
  const card = document.createElement("article");
  card.className = "admin-card";

  const header = document.createElement("div");
  header.className = "admin-card__header";

  const nameInput = textInput(player.name, (v) => (player.name = v), "Player name");
  nameInput.classList.add("admin-name");
  header.append(field("Name", nameInput));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "admin-remove";
  remove.textContent = "Remove player";
  remove.addEventListener("click", () => {
    const index = state.data.players.indexOf(player);
    if (index >= 0) {
      state.data.players.splice(index, 1);
      renderEditor();
    }
  });
  header.append(remove);
  card.append(header);

  const details = document.createElement("div");
  details.className = "admin-grid";
  details.append(
    field(
      "Final prediction",
      textInput(
        player.finalPrediction ?? "",
        (v) => {
          player.finalPrediction = v;
          player.predictedFinalists = v
            .split(/\s+v\s+/i)
            .map((team) => team.trim())
            .filter(Boolean);
        },
        "e.g. France v Spain"
      )
    ),
    field(
      "Group-stage goalscorer",
      textInput(
        player.designatedGoalscorerGroup ?? "",
        (v) => (player.designatedGoalscorerGroup = v),
        "e.g. Mbappe (Fra)"
      )
    ),
    field(
      "Knockout goalscorer",
      textInput(
        player.designatedGoalscorerKnockout ?? "",
        (v) => (player.designatedGoalscorerKnockout = v),
        "e.g. Messi (Arg)"
      )
    )
  );
  card.append(details);

  const baselineTitle = document.createElement("p");
  baselineTitle.className = "admin-subtitle";
  baselineTitle.textContent = "Historical points (group stage → Round of 16)";
  card.append(baselineTitle);

  if (!player.baseline) {
    player.baseline = {
      matchday1: 0,
      matchday2: 0,
      matchday3: 0,
      groupTotal: 0,
      r32: 0,
      r16: 0,
      goalscorerPoints: 0
    };
  }
  const baseline = player.baseline;
  const baselineGrid = document.createElement("div");
  baselineGrid.className = "admin-grid";
  const baselineFields = [
    ["Matchday 1", "matchday1"],
    ["Matchday 2", "matchday2"],
    ["Matchday 3", "matchday3"],
    ["Group total", "groupTotal"],
    ["Round of 32", "r32"],
    ["Round of 16", "r16"],
    ["Goalscorer pts", "goalscorerPoints"]
  ];
  for (const [label, key] of baselineFields) {
    baselineGrid.append(
      field(label, numberInput(baseline[key] ?? 0, (v) => (baseline[key] = v ?? 0), { min: 0 }))
    );
  }
  card.append(baselineGrid);

  const predictionsTitle = document.createElement("p");
  predictionsTitle.className = "admin-subtitle";
  predictionsTitle.textContent = "Match predictions";
  card.append(predictionsTitle);

  if (matches.length > 0) {
    const paste = document.createElement("div");
    paste.className = "admin-paste";

    const pasteLabel = document.createElement("p");
    pasteLabel.className = "admin-paste__label";
    pasteLabel.textContent = "Paste from WhatsApp (fills scores in fixture order)";
    paste.append(pasteLabel);

    const textarea = document.createElement("textarea");
    textarea.className = "admin-paste__input";
    textarea.rows = 4;
    textarea.placeholder =
      `${matches.map((m) => `${m.homeTeam} x-x ${m.awayTeam}`).join("\n")}`;
    paste.append(textarea);

    const pasteStatus = document.createElement("p");
    pasteStatus.className = "admin-paste__status";
    pasteStatus.hidden = true;

    const fill = document.createElement("button");
    fill.type = "button";
    fill.className = "admin-ghost";
    fill.textContent = "Fill scores from paste";
    fill.addEventListener("click", () => {
      const result = parseScoreSequence(textarea.value, matches.length);
      if (!result.ok) {
        pasteStatus.hidden = false;
        pasteStatus.dataset.kind = "error";
        pasteStatus.textContent = `Found ${result.found} numbers, expected ${result.expected} (one home + away score per match). Check the paste and try again.`;
        return;
      }
      matches.forEach((match, index) => {
        if (!player.predictions[match.id]) {
          player.predictions[match.id] = { home: null, away: null };
        }
        player.predictions[match.id].home = result.scores[index].home;
        player.predictions[match.id].away = result.scores[index].away;
      });
      renderEditor();
      setStatus(`Filled ${matches.length} predictions for ${player.name}. Remember to Save changes.`, "success");
    });
    paste.append(fill, pasteStatus);
    card.append(paste);
  }

  for (const match of matches) {
    if (!player.predictions[match.id]) {
      player.predictions[match.id] = { home: null, away: null };
    }
    const prediction = player.predictions[match.id];

    const block = document.createElement("div");
    block.className = "admin-prediction";

    const label = document.createElement("p");
    label.className = "admin-prediction__label";
    label.textContent = `${match.homeTeam} v ${match.awayTeam}`;
    block.append(label);

    const grid = document.createElement("div");
    grid.className = "admin-grid";
    grid.append(
      field("Home", numberInput(prediction.home, (v) => (prediction.home = v))),
      field("Away", numberInput(prediction.away, (v) => (prediction.away = v)))
    );
    block.append(grid);
    card.append(block);
  }

  return card;
}

function renderEditor() {
  if (!state.data) {
    return;
  }

  refs.matches.replaceChildren(
    ...state.data.matches.map((match) => renderMatchEditor(match))
  );

  const actualFinalists = textInput(
    state.data.actualFinalists.join(", "),
    (v) => {
      state.data.actualFinalists = v
        .split(",")
        .map((team) => team.trim())
        .filter(Boolean);
    },
    "e.g. Brazil, France"
  );
  refs.finalists.replaceChildren(field("Actual finalists (comma separated)", actualFinalists));

  refs.players.replaceChildren(
    ...state.data.players.map((player) => renderPlayerEditor(player, state.data.matches))
  );
}

function showEditor(visible) {
  refs.login.hidden = visible;
  refs.editor.hidden = !visible;
  refs.logout.hidden = !visible;
}

async function loadSession() {
  const response = await fetch("/api/session", { cache: "no-store" });
  const session = await response.json();
  state.admin = session.admin;
  state.authRequired = session.authRequired;
  state.footballApi = Boolean(session.footballApi);

  if (!state.authRequired) {
    refs.loginError.hidden = false;
    refs.loginError.textContent = "Admin editing is not configured on the server.";
    refs.loginForm.hidden = true;
  }
}

async function beginEditing() {
  const response = await fetch("/api/data", { cache: "no-store" });
  state.data = clone(await response.json());
  showEditor(true);
  if (refs.apiActions) {
    refs.apiActions.hidden = !state.footballApi;
  }
  renderEditor();
  setStatus("Loaded current data. Make changes, then save.");
}

async function handleImportFixtures() {
  if (!state.data) {
    return;
  }
  setStatus("Importing fixtures from API-Football…");
  try {
    const response = await fetch("/api/football/fixtures", { cache: "no-store" });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Import failed (${response.status})`);
    }
    const { fixtures } = await response.json();
    let added = 0;
    let updated = 0;
    for (const fx of fixtures) {
      const existing = state.data.matches.find((m) => m.apiFixtureId === fx.apiFixtureId);
      if (existing) {
        existing.homeTeam = fx.homeTeam || existing.homeTeam;
        existing.awayTeam = fx.awayTeam || existing.awayTeam;
        existing.stage = fx.stage || existing.stage;
        existing.kickoff = fx.kickoff || existing.kickoff;
        updated += 1;
      } else {
        state.data.matches.push({
          id: `api-${fx.apiFixtureId}`,
          apiFixtureId: fx.apiFixtureId,
          stage: fx.stage,
          kickoff: fx.kickoff,
          homeTeam: fx.homeTeam,
          awayTeam: fx.awayTeam,
          status: fx.status,
          actual: { home: null, away: null },
          goalscorers: []
        });
        added += 1;
      }
    }
    renderEditor();
    setStatus(
      `Imported ${added} new + updated ${updated} fixtures. Review, then Save changes.`,
      "success"
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleSyncNow() {
  setStatus("Syncing live scores…");
  try {
    const response = await fetch("/api/football/sync", { method: "POST" });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Sync failed (${response.status})`);
    }
    const { data } = await response.json();
    state.data = clone(data);
    renderEditor();
    setStatus("Synced from API-Football.", "success");
    document.dispatchEvent(new CustomEvent("scoreboard:refresh"));
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function togglePanel() {
  const open = refs.panel.hidden;
  refs.panel.hidden = !open;
  refs.toggle.setAttribute("aria-expanded", String(open));

  if (open && state.admin) {
    beginEditing();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  refs.loginError.hidden = true;

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: refs.password.value })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    refs.loginError.hidden = false;
    refs.loginError.textContent = error.error || "Login failed";
    return;
  }

  state.admin = true;
  refs.password.value = "";
  await beginEditing();
}

async function handleSave() {
  setStatus("Saving...");
  refs.save.disabled = true;

  try {
    const response = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.data)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Save failed (${response.status})`);
    }

    const saved = await response.json();
    state.data = clone(saved);
    renderEditor();
    setStatus("Saved. Leaderboard updated.", "success");
    document.dispatchEvent(new CustomEvent("scoreboard:refresh"));
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    refs.save.disabled = false;
  }
}

async function handleLogout() {
  await fetch("/api/logout", { method: "POST" });
  state.admin = false;
  state.data = null;
  showEditor(false);
  refs.panel.hidden = true;
  refs.toggle.setAttribute("aria-expanded", "false");
}

function handleAddPlayer() {
  if (!state.data) {
    return;
  }
  state.data.players.push({
    name: "",
    previousPosition: null,
    finalPrediction: "",
    predictedFinalists: [],
    designatedGoalscorerGroup: "",
    designatedGoalscorerKnockout: "",
    baseline: {
      matchday1: 0,
      matchday2: 0,
      matchday3: 0,
      groupTotal: 0,
      r32: 0,
      r16: 0,
      goalscorerPoints: 0
    },
    predictions: {}
  });
  renderEditor();
}

function handleAddMatch() {
  if (!state.data) {
    return;
  }
  const n = state.data.matches.length + 1;
  state.data.matches.push({
    id: `qf-${n}`,
    stage: "Quarter-final",
    kickoff: "",
    homeTeam: "",
    awayTeam: "",
    status: "scheduled",
    actual: { home: null, away: null },
    goalscorers: []
  });
  renderEditor();
}

export async function initAdmin() {
  if (!refs.toggle) {
    return;
  }

  await loadSession();

  refs.toggle.addEventListener("click", togglePanel);
  refs.loginForm.addEventListener("submit", handleLogin);
  refs.save.addEventListener("click", handleSave);
  refs.logout.addEventListener("click", handleLogout);
  refs.addPlayer.addEventListener("click", handleAddPlayer);
  refs.addMatch.addEventListener("click", handleAddMatch);
  if (refs.importFixtures) {
    refs.importFixtures.addEventListener("click", handleImportFixtures);
  }
  if (refs.syncNow) {
    refs.syncNow.addEventListener("click", handleSyncNow);
  }

  showEditor(false);
}

initAdmin();
