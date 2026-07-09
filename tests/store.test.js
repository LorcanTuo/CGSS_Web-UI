import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScoreboardStore, sanitiseData } from "../server/store.js";

test("sanitiseData rejects non-objects and missing arrays", () => {
  assert.throws(() => sanitiseData(null));
  assert.throws(() => sanitiseData({ players: [] }));
  assert.throws(() => sanitiseData({ matches: [] }));
});

test("sanitiseData coerces scores, clamps goals, and keeps valid status", () => {
  const clean = sanitiseData({
    matches: [
      {
        id: "qf-1",
        homeTeam: "Brazil",
        awayTeam: "Spain",
        status: "live",
        actual: { home: "2", away: "" },
        goalscorers: [
          { name: " Vini ", goals: "0" },
          { name: "", goals: 3 }
        ]
      },
      {
        homeTeam: "France",
        awayTeam: "Argentina",
        status: "banana",
        actual: { home: -4, away: 1.9 }
      }
    ],
    players: [
      {
        name: "Alex",
        predictedFinalists: ["Brazil", "", "France"],
        predictions: {
          "qf-1": { home: "1", away: 0, goalscorer: " Vini " },
          "ghost-match": { home: 1, away: 1 }
        }
      },
      { name: "" }
    ]
  });

  assert.equal(clean.matches[0].actual.home, 2);
  assert.equal(clean.matches[0].actual.away, null);
  assert.deepEqual(clean.matches[0].goalscorers, [{ name: "Vini", team: "", goals: 1 }]);

  assert.equal(clean.matches[1].id, "match-2");
  assert.equal(clean.matches[1].status, "scheduled");
  assert.equal(clean.matches[1].actual.home, null);
  assert.equal(clean.matches[1].actual.away, 1);

  assert.equal(clean.players.length, 1);
  assert.deepEqual(clean.players[0].predictedFinalists, ["Brazil", "France"]);
  assert.equal(clean.players[0].predictions["qf-1"].home, 1);
  assert.ok(!("goalscorer" in clean.players[0].predictions["qf-1"]));
  assert.ok(!("ghost-match" in clean.players[0].predictions));
  assert.equal(clean.players[0].baseline.groupTotal, 0);
  assert.ok(clean.lastUpdated);
});

test("store seeds on first init and round-trips saves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scoreboard-store-"));
  const dataFile = join(dir, "scoreboard.json");

  try {
    const store = new ScoreboardStore(dataFile);
    const seeded = await store.init();
    assert.ok(Array.isArray(seeded.players));
    assert.ok(seeded.players.length > 0);
    assert.ok(Array.isArray(seeded.matches));

    const onDisk = JSON.parse(await readFile(dataFile, "utf8"));
    assert.equal(onDisk.players.length, seeded.players.length);

    seeded.players[0].baseline.r16 = 99;
    const saved = await store.save(seeded);
    assert.equal(saved.players[0].baseline.r16, 99);

    const reloaded = await store.load();
    assert.equal(reloaded.players[0].baseline.r16, 99);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
