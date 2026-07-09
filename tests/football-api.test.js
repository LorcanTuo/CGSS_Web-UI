import test from "node:test";
import assert from "node:assert/strict";
import { goalscorersFromEvents } from "../server/football-api.js";

const ev = (name, team, elapsed, detail = "Normal Goal", type = "Goal") => ({
  type,
  detail,
  time: { elapsed, extra: null },
  team: { name: team },
  player: { name }
});

test("counts normal-time goals and tallies multiple by the same player", () => {
  const scorers = goalscorersFromEvents([
    ev("Mbappe", "France", 12),
    ev("Mbappe", "France", 44),
    ev("Osimhen", "Morocco", 70)
  ]);
  const byName = Object.fromEntries(scorers.map((s) => [s.name, s.goals]));
  assert.equal(byName["Mbappe"], 2);
  assert.equal(byName["Osimhen"], 1);
});

test("excludes extra-time goals (minute > 90)", () => {
  const scorers = goalscorersFromEvents([
    ev("Mbappe", "France", 90),
    ev("Mbappe", "France", 105) // extra time - must be ignored
  ]);
  assert.equal(scorers.find((s) => s.name === "Mbappe").goals, 1);
});

test("counts injury-time goals (minute 90 with extra) as normal time", () => {
  const scorers = goalscorersFromEvents([
    { type: "Goal", detail: "Normal Goal", time: { elapsed: 90, extra: 4 }, team: { name: "Spain" }, player: { name: "Yamal" } }
  ]);
  assert.equal(scorers[0].name, "Yamal");
  assert.equal(scorers[0].goals, 1);
});

test("ignores own goals and missed penalties", () => {
  const scorers = goalscorersFromEvents([
    ev("Defender", "Belgium", 30, "Own Goal"),
    ev("Taker", "Spain", 55, "Missed Penalty")
  ]);
  assert.equal(scorers.length, 0);
});

test("counts penalties scored in normal time", () => {
  const scorers = goalscorersFromEvents([ev("Kane", "England", 60, "Penalty")]);
  assert.equal(scorers[0].name, "Kane");
  assert.equal(scorers[0].goals, 1);
});
