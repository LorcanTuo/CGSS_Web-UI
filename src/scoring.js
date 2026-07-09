const DRAW = "draw";

const PREMATCH_WINDOW_MS = 30 * 60 * 1000; // start watching 30 min before kickoff
const STALE_SCHEDULED_MS = 3 * 60 * 60 * 1000; // don't treat a >3h-old scheduled match as active

/**
 * Returns the kickoff timestamp (ms) that defines the current active match window:
 * - If a match is live → its kickoff time
 * - If a scheduled match is within 30 min (or overdue by <3h) → its kickoff time
 * - Otherwise → the most recently completed match's kickoff (keeps deltas visible)
 * - null if there are no relevant matches yet
 */
function activeWindowKickoff(matches, now) {
  const live = matches.filter((m) => m.status === "live");
  if (live.length > 0) {
    return Math.min(...live.map((m) => Date.parse(m.kickoff)));
  }

  const nearKickoff = matches
    .filter((m) => m.status === "scheduled")
    .map((m) => ({ ...m, t: Date.parse(m.kickoff) }))
    .filter(
      (m) =>
        Number.isFinite(m.t) &&
        m.t - now <= PREMATCH_WINDOW_MS &&
        now - m.t <= STALE_SCHEDULED_MS
    )
    .sort((a, b) => a.t - b.t);

  if (nearKickoff.length > 0) return nearKickoff[0].t;

  const finals = matches
    .filter((m) => m.status === "final")
    .map((m) => ({ ...m, t: Date.parse(m.kickoff) }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => b.t - a.t);

  if (finals.length > 0) return finals[0].t;

  return null;
}

function normalise(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function hasScore(score) {
  return Number.isFinite(score?.home) && Number.isFinite(score?.away);
}

export function getOutcome(homeGoals, awayGoals, homeTeam, awayTeam) {
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
    return null;
  }

  if (homeGoals === awayGoals) {
    return DRAW;
  }

  return homeGoals > awayGoals ? homeTeam : awayTeam;
}

export function calculateMatchScore(prediction, match, designatedScorer = "") {
  const score = {
    total: 0,
    winner: 0,
    scoreline: 0,
    goalscorer: 0
  };

  if (!prediction || !hasScore(match.actual)) {
    return score;
  }

  const predictedWinner = getOutcome(
    prediction.home,
    prediction.away,
    match.homeTeam,
    match.awayTeam
  );
  const actualWinner = getOutcome(
    match.actual.home,
    match.actual.away,
    match.homeTeam,
    match.awayTeam
  );

  if (predictedWinner && normalise(predictedWinner) === normalise(actualWinner)) {
    score.winner = 5;
  }

  if (prediction.home === match.actual.home && prediction.away === match.actual.away) {
    const goals = match.actual.home + match.actual.away;
    score.scoreline = 2 + goals + (goals === 0 ? 1 : 0);
  }

  const selectedScorer = normalise(designatedScorer);
  if (selectedScorer) {
    const goals = (match.goalscorers ?? [])
      .filter((scorer) => {
        const apiName = normalise(scorer.name);
        // Allow "MBAPPE (Fra)" to match API name "Mbappe", and handle
        // multi-word names like "Bruno Fernandes" vs "Bruno FERNANDES (Por)".
        return apiName === selectedScorer ||
          selectedScorer.includes(apiName) ||
          apiName.includes(selectedScorer);
      })
      .reduce((sum, scorer) => sum + scorer.goals, 0);

    if (goals > 0) {
      score.goalscorer = goals * 3 + (goals >= 3 ? 2 : 0);
    }
  }

  score.total = score.winner + score.scoreline + score.goalscorer;
  return score;
}

export function calculateFinalistScore(predictedFinalists = [], actualFinalists = []) {
  const actual = new Set(actualFinalists.map(normalise));

  return predictedFinalists.reduce((points, finalist) => {
    return points + (actual.has(normalise(finalist)) ? 5 : 0);
  }, 0);
}

export function calculateBaselineTotal(baseline = {}) {
  const groupTotal = Number(baseline.groupTotal) || 0;
  const r32 = Number(baseline.r32) || 0;
  const r16 = Number(baseline.r16) || 0;
  const goalscorerPoints = Number(baseline.goalscorerPoints) || 0;
  return groupTotal + r32 + r16 + goalscorerPoints;
}

export function calculateLeaderboard(data, { now = Date.now(), _skipDelta = false } = {}) {
  const matches = data.matches ?? [];
  const actualFinalists = data.actualFinalists ?? [];

  // Build a pre-match rank map so we can show position changes.
  // Pre-match = leaderboard calculated using only matches that went final
  // before the current active window's kickoff.
  let preRankMap = null;
  if (!_skipDelta) {
    const windowKickoff = activeWindowKickoff(matches, now);
    if (windowKickoff !== null) {
      const preMatches = matches.filter(
        (m) => m.status === "final" && Date.parse(m.kickoff) < windowKickoff
      );
      const pre = calculateLeaderboard(
        { ...data, matches: preMatches },
        { now, _skipDelta: true }
      );
      preRankMap = new Map(pre.map((p) => [p.name, p.rank]));
    }
  }

  return (data.players ?? [])
    .map((player) => {
      const baseline = player.baseline ?? {};
      const baselineTotal = calculateBaselineTotal(baseline);

      const live = {
        winner: 0,
        scoreline: 0,
        goalscorer: 0,
        finalists: calculateFinalistScore(player.predictedFinalists, actualFinalists)
      };

      const matchBreakdown = matches.map((match) => {
      const matchScore = calculateMatchScore(
        player.predictions?.[match.id],
        match,
        player.designatedGoalscorerKnockout
      );
        live.winner += matchScore.winner;
        live.scoreline += matchScore.scoreline;
        live.goalscorer += matchScore.goalscorer;

        return {
          matchId: match.id,
          ...matchScore
        };
      });

      const liveTotal = live.winner + live.scoreline + live.goalscorer + live.finalists;
      const total = baselineTotal + liveTotal;

      return {
        name: player.name,
        previousPosition: player.previousPosition ?? null,
        finalPrediction: player.finalPrediction ?? "",
        designatedGoalscorerGroup: player.designatedGoalscorerGroup ?? "",
        designatedGoalscorerKnockout: player.designatedGoalscorerKnockout ?? "",
        predictedFinalists: player.predictedFinalists ?? [],
        baseline,
        baselineTotal,
        liveTotal,
        total,
        breakdown: live,
        matchBreakdown
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .reduce((ranked, player, index) => {
      const previous = ranked[index - 1];
      const rank = previous && previous.total === player.total ? previous.rank : index + 1;
      const previousRank = preRankMap ? (preRankMap.get(player.name) ?? rank) : null;
      const move = previousRank !== null ? previousRank - rank : null;
      ranked.push({ ...player, rank, previousRank, move });
      return ranked;
    }, []);
}

export function summariseData(data) {
  const matches = data.matches ?? [];
  const completed = matches.filter((match) => match.status === "final").length;
  const live = matches.filter((match) => match.status === "live").length;

  return {
    players: data.players?.length ?? 0,
    matches: matches.length,
    completed,
    live
  };
}
