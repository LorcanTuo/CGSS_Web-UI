import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBaselineTotal,
  calculateFinalistScore,
  calculateLeaderboard,
  calculateMatchScore
} from "../src/scoring.js";

test("awards winner, exact scoreline, goal total bonus, and goalscorer points", () => {
  const score = calculateMatchScore(
    { home: 3, away: 1 },
    {
      homeTeam: "Home",
      awayTeam: "Away",
      actual: { home: 3, away: 1 },
      goalscorers: [{ name: "Player One", goals: 2 }]
    },
    "Player One"
  );

  assert.deepEqual(score, {
    total: 17,
    winner: 5,
    scoreline: 6,
    goalscorer: 6
  });
});

test("awards the extra point for a correctly predicted 0-0", () => {
  const score = calculateMatchScore(
    { home: 0, away: 0 },
    {
      homeTeam: "Home",
      awayTeam: "Away",
      actual: { home: 0, away: 0 },
      goalscorers: []
    },
    "Nobody"
  );

  assert.equal(score.winner, 5);
  assert.equal(score.scoreline, 3);
  assert.equal(score.total, 8);
});

test("awards hat-trick bonus for selected goalscorer", () => {
  const score = calculateMatchScore(
    { home: 4, away: 2 },
    {
      homeTeam: "Home",
      awayTeam: "Away",
      actual: { home: 1, away: 3 },
      goalscorers: [{ name: "Hat Trick Hero", goals: 3 }]
    },
    "Hat Trick Hero"
  );

  assert.equal(score.goalscorer, 11);
  assert.equal(score.total, 11);
});

test("awards five points per correct predicted finalist", () => {
  assert.equal(calculateFinalistScore(["Spain", "France"], ["France", "Brazil"]), 5);
  assert.equal(calculateFinalistScore(["Brazil", "France"], ["France", "Brazil"]), 10);
});

test("sorts leaderboard by total, preserving tied rank numbers", () => {
  const leaderboard = calculateLeaderboard({
    actualFinalists: ["Brazil", "France"],
    matches: [
      {
        id: "qf-1",
        homeTeam: "Brazil",
        awayTeam: "Spain",
        actual: { home: 1, away: 0 },
        goalscorers: [{ name: "Scorer", goals: 1 }]
      }
    ],
    players: [
      {
        name: "B",
        predictedFinalists: ["Brazil"],
        predictions: { "qf-1": { home: 0, away: 1, goalscorer: "Scorer" } }
      },
      {
        name: "A",
        predictedFinalists: ["Brazil"],
        predictions: { "qf-1": { home: 0, away: 1, goalscorer: "Scorer" } }
      },
      {
        name: "Winner",
        predictedFinalists: ["Brazil", "France"],
        predictions: { "qf-1": { home: 1, away: 0, goalscorer: "Scorer" } }
      }
    ]
  });

  assert.deepEqual(
    leaderboard.map((player) => [player.rank, player.name]),
    [
      [1, "Winner"],
      [2, "A"],
      [2, "B"]
    ]
  );
});

test("baseline total sums group, R32, R16, and goalscorer points", () => {
  assert.equal(
    calculateBaselineTotal({ groupTotal: 183, r32: 79, r16: 25, goalscorerPoints: 21 }),
    308
  );
});

// ── Dynamic position tracking ────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function makeData(matchStatus, nowOffset = 0) {
  // Two players, player A has a higher baseline so leads before any matches.
  // Match kicks off at t=0; nowOffset moves the clock relative to kickoff.
  const kickoff = new Date(Date.now() + nowOffset).toISOString();
  return {
    now: Date.now(),
    data: {
      actualFinalists: [],
      matches: [
        {
          id: "m1",
          kickoff,
          homeTeam: "France",
          awayTeam: "Morocco",
          status: matchStatus,
          actual: matchStatus === "scheduled" ? { home: null, away: null } : { home: 2, away: 1 },
          goalscorers: []
        }
      ],
      players: [
        // Player A: higher baseline, predicts correctly → stays top
        {
          name: "A",
          baseline: { groupTotal: 200, r32: 0, r16: 0, goalscorerPoints: 0 },
          predictedFinalists: [],
          predictions: { m1: { home: 2, away: 1 } } // correct: +5+4=9
        },
        // Player B: lower baseline, also predicts correctly
        {
          name: "B",
          baseline: { groupTotal: 180, r32: 0, r16: 0, goalscorerPoints: 0 },
          predictedFinalists: [],
          predictions: { m1: { home: 2, away: 1 } } // same points
        },
        // Player C: low baseline, wrong prediction → falls
        {
          name: "C",
          baseline: { groupTotal: 195, r32: 0, r16: 0, goalscorerPoints: 0 },
          predictedFinalists: [],
          predictions: { m1: { home: 0, away: 0 } }
        }
      ]
    }
  };
}

test("shows no position arrows more than 30 min before kickoff", () => {
  const { data, now } = makeData("scheduled", 60 * MINUTE); // kickoff in 60 min
  const leaderboard = calculateLeaderboard(data, { now });
  for (const player of leaderboard) {
    assert.equal(player.previousRank, null, `${player.name} should have no previousRank`);
    assert.equal(player.move, null, `${player.name} should have no move`);
  }
});

test("shows no arrows (move=0) in the 30-min pre-match window", () => {
  const { data, now } = makeData("scheduled", 15 * MINUTE); // kickoff in 15 min
  const leaderboard = calculateLeaderboard(data, { now });
  // All moves should be 0 — standings haven't changed yet
  for (const player of leaderboard) {
    assert.equal(player.move, 0, `${player.name} should have move=0 before kickoff`);
  }
});

test("shows position changes once a match is live", () => {
  // Pre-match order (by baseline): A(200), C(195), B(180)
  // After match: A(209), B(189), C(195) → new order A, C, B — wait:
  // A: 200+9=209, B: 180+9=189, C: 195+0=195 → A(1), C(2), B(3)
  // Pre-match: A(1), C(2), B(3) — no change? Let me recalculate.
  // Pre-match = no matches final before this kickoff → pre = baseline only
  // baseline order: A(200 #1), C(195 #2), B(180 #3)
  // live order: A(209 #1), C(195 #2), B(189 #3) — same order, no movement
  // Let me use a scenario where C drops:
  const { data, now } = makeData("live", 0);
  const leaderboard = calculateLeaderboard(data, { now });
  const byName = Object.fromEntries(leaderboard.map((p) => [p.name, p]));

  // A: baseline 200, correct 2-1: +5(winner)+4(scoreline)=9 → total 209, rank #1
  // C: baseline 195, wrong prediction → total 195, rank #2
  // B: baseline 180, correct 2-1: +9 → total 189, rank #3

  // Pre-match (no finals before kickoff): A(#1), C(#2), B(#3)
  // Live:                                  A(#1), C(#2), B(#3)
  assert.equal(byName["A"].rank, 1);
  assert.equal(byName["A"].previousRank, 1);
  assert.equal(byName["A"].move, 0);

  assert.equal(byName["C"].rank, 2);
  assert.equal(byName["C"].previousRank, 2);

  assert.equal(byName["B"].rank, 3);
  assert.equal(byName["B"].previousRank, 3);
});

test("resets arrows (move=0) at the 30-min window before a second match", () => {
  // First match is final; second match kicks off in 15 min
  const now = Date.now();
  const firstKickoff = new Date(now - 2 * HOUR).toISOString();
  const secondKickoff = new Date(now + 15 * MINUTE).toISOString();

  const data = {
    actualFinalists: [],
    matches: [
      {
        id: "m1",
        kickoff: firstKickoff,
        homeTeam: "France", awayTeam: "Morocco",
        status: "final",
        actual: { home: 2, away: 1 },
        goalscorers: []
      },
      {
        id: "m2",
        kickoff: secondKickoff,
        homeTeam: "Spain", awayTeam: "Belgium",
        status: "scheduled",
        actual: { home: null, away: null },
        goalscorers: []
      }
    ],
    players: [
      {
        name: "A",
        baseline: { groupTotal: 200, r32: 0, r16: 0, goalscorerPoints: 0 },
        predictedFinalists: [],
        predictions: { m1: { home: 2, away: 1 }, m2: { home: 1, away: 0 } }
      },
      {
        name: "B",
        baseline: { groupTotal: 180, r32: 0, r16: 0, goalscorerPoints: 0 },
        predictedFinalists: [],
        predictions: { m1: { home: 0, away: 0 }, m2: { home: 1, away: 0 } }
      }
    ]
  };

  const leaderboard = calculateLeaderboard(data, { now });
  // Active window = second match (within 30 min)
  // Pre-match = finals before second kickoff = [m1]
  // Pre-leaderboard: A(200+9=209 #1), B(180 #2)
  // Current: same (m2 not started) → moves all 0
  for (const player of leaderboard) {
    assert.equal(player.move, 0, `${player.name} move should reset to 0 before second match`);
  }
});


test("leaderboard adds live QF points on top of the historical baseline", () => {
  const leaderboard = calculateLeaderboard({
    actualFinalists: [],
    matches: [
      {
        id: "qf-1",
        homeTeam: "France",
        awayTeam: "Spain",
        actual: { home: 2, away: 1 },
        goalscorers: [{ name: "Mbappe", goals: 1 }]
      }
    ],
    players: [
      {
        name: "Baseline leader",
        baseline: { groupTotal: 183, r32: 79, r16: 25, goalscorerPoints: 21 },
        predictedFinalists: [],
        predictions: {}
      },
      {
        name: "Live climber",
        baseline: { groupTotal: 150, r32: 79, r16: 25, goalscorerPoints: 21 },
        predictedFinalists: [],
        designatedGoalscorerKnockout: "Mbappe",
        // correct winner (5) + exact 2-1 (2+3=5) + Mbappe 1 goal (3) = 13
        predictions: { "qf-1": { home: 2, away: 1 } }
      }
    ]
  });

  const byName = Object.fromEntries(leaderboard.map((p) => [p.name, p]));
  assert.equal(byName["Baseline leader"].total, 308);
  assert.equal(byName["Live climber"].baselineTotal, 275);
  assert.equal(byName["Live climber"].liveTotal, 13);
  assert.equal(byName["Live climber"].total, 288);
  assert.equal(leaderboard[0].name, "Baseline leader");
});
