import {
  Cell,
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { resourceAt } from "@openfront/engine-lib/game/NaturalResources";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { getNationDoctrine } from "@openfront/engine/execution/nation/NationDoctrine";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { RecomputeRailClusterExecution } from "@openfront/engine/execution/RecomputeRailClusterExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { createGame } from "@openfront/engine/game/GameImpl";
import { RESOURCE_BUILDINGS } from "@openfront/engine/game/ResourceEconomy";
import { createHash } from "node:crypto";
/** Opt-in, production-map/production-rules audit. Run with OBJECTIVE_AUDIT=1. */
import fs from "node:fs";
import path from "node:path";

const runAudit = process.env.OBJECTIVE_AUDIT === "1";
const minutes = Number(process.env.OBJECTIVE_AUDIT_MINUTES ?? 15);
const seeds = (
  process.env.OBJECTIVE_AUDIT_SEEDS ?? "frontier-a,frontier-b,frontier-c"
).split(",");
const output =
  process.env.OBJECTIVE_AUDIT_OUTPUT ?? "/tmp/myfront-objective-audit.json";
const difficulty = (process.env.OBJECTIVE_AUDIT_DIFFICULTY ??
  Difficulty.Hard) as Difficulty;
const sourceFingerprint = createHash("sha256")
  .update(
    [
      "packages/engine/src/execution/NationExecution.ts",
      "packages/engine/src/execution/nation/NationObjectives.ts",
      "packages/engine/src/execution/nation/NationAttackBehavior.ts",
    ]
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n"),
  )
  .digest("hex");
const results: unknown[] = [];
const enabled = process.env.OBJECTIVE_AUDIT_DISABLE !== "1";

describe.runIf(runAudit)("production World objective simulations", () => {
  for (const seed of seeds)
    test(
      seed,
      async () => {
        const dir = path.resolve("resources/maps/world");
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        );
        const map = await genTerrainFromBin(
          manifest.map,
          fs.readFileSync(path.join(dir, "map.bin")),
        );
        const mini = await genTerrainFromBin(
          manifest.map4x,
          fs.readFileSync(path.join(dir, "map4x.bin")),
        );
        const nations = manifest.nations.map(
          (n: { name: string; flag: string; coordinates: [number, number] }) =>
            new Nation(
              new Cell(...n.coordinates),
              new PlayerInfo(
                n.name,
                PlayerType.Nation,
                null,
                n.name,
                false,
                null,
                [],
                null,
                n.flag,
              ),
            ),
        );
        const config = new EngineConfig(
          {
            gameMap: GameMapType.World,
            gameMapSize: GameMapSize.Normal,
            donateGold: false,
            donateTroops: false,
            gameMode: GameMode.FFA,
            gameType: GameType.Singleplayer,
            difficulty,
            nations: "default",
            bots: 0,
            infiniteGold: false,
            infiniteTroops: false,
            instantBuild: false,
            randomSpawn: false,
          },
          false,
        );
        const game = createGame([], nations, map, mini, config);
        const events: {
          tick: number;
          country: string;
          kind: string;
          target: number | null;
          tile: number | null;
          reason: string;
        }[] = [];
        const byCountry: Record<
          string,
          {
            doctrine: string;
            objectives: Record<string, number>;
            attacks: number;
            objectiveBuilds: number;
            captures: number;
            completedDevelopment: number;
            stalled: number;
          }
        > = {};
        let planMs = 0,
          planCalls = 0,
          totalAttacks = 0,
          friendlyAttacks = 0,
          alliances = 0;
        const attacks = game.stats().attack.bind(game.stats());
        game.stats().attack = (p, t, troops) => {
          if (t.isPlayer()) {
            totalAttacks++;
            if (p.isFriendly(t)) friendlyAttacks++;
            if (byCountry[p.id()]) byCountry[p.id()].attacks++;
          }
          attacks(p, t, troops);
        };
        const formed = game.stats().allianceFormed.bind(game.stats());
        game.stats().allianceFormed = (p) => {
          alliances++;
          formed(p);
        };
        for (const nation of nations) {
          const exec = new NationExecution(seed, nation);
          const info = nation.playerInfo;
          const tally: (typeof byCountry)[string] = (byCountry[info.id] = {
            doctrine: getNationDoctrine(info.nationFlag, info.name).id,
            objectives: {},
            attacks: 0,
            objectiveBuilds: 0,
            captures: 0,
            completedDevelopment: 0,
            stalled: 0,
          });
          const originalInit = exec["initializeBehaviors"].bind(exec);
          exec["initializeBehaviors"] = () => {
            originalInit();
            const behavior = exec["structureBehavior"];
            const build = behavior["maybeBuildObjective"].bind(behavior);
            behavior["maybeBuildObjective"] = () => {
              const ok = build();
              if (ok) tally.objectiveBuilds++;
              return ok;
            };
          };
          const update = exec["updateObjective"].bind(exec);
          exec["updateObjective"] = (tick: number) => {
            const before = exec["objective"];
            const start = performance.now();
            if (enabled) update(tick);
            planMs += performance.now() - start;
            planCalls++;
            const after = exec["objective"];
            if (
              after?.startedTick !== before?.startedTick ||
              after?.kind !== before?.kind ||
              after?.tile !== before?.tile
            ) {
              let reason = "selected";
              if (before) {
                const own = game.player(info.id);
                if (
                  (before.kind === "capture" || before.kind === "maritime") &&
                  before.targetSmallID !== null &&
                  before.tile !== null &&
                  game.owner(before.tile) === own
                ) {
                  tally.captures++;
                  reason = "captured";
                } else if (
                  before.kind === "develop" &&
                  before.tile !== null &&
                  (before.unitId !== null
                    ? (game.unit(before.unitId)?.level() ?? 0) >
                      before.initialLevel
                    : own
                        .units(RESOURCE_BUILDINGS)
                        .some(
                          (u) =>
                            resourceAt(game.map(), GameMapType.World, u.tile())
                              ?.id === before.siteId,
                        ))
                ) {
                  tally.completedDevelopment++;
                  reason = "developed";
                } else if (tick >= before.expiresTick) {
                  tally.stalled++;
                  reason = "expired";
                } else reason = "reassessed";
              }
              if (after)
                tally.objectives[after.kind] =
                  (tally.objectives[after.kind] ?? 0) + 1;
              events.push({
                tick,
                country: info.name,
                kind: after?.kind ?? "none",
                target: after?.targetSmallID ?? null,
                tile: after?.tile ?? null,
                reason,
              });
            }
          };
          game.addExecution(exec);
        }
        game.addExecution(
          new RecomputeRailClusterExecution(game.railNetwork()),
          new WinCheckExecution(),
        );
        for (
          let t = 0;
          t < 100 && game.allPlayers().some((p) => !p.hasSpawned());
          t++
        )
          game.executeNextTick();
        expect(game.allPlayers().every((p) => p.hasSpawned())).toBe(true);
        game.endSpawnPhase();
        const samples: unknown[] = [];
        const ticksMs: number[] = [];
        const start = performance.now();
        for (let minute = 1; minute <= minutes; minute++) {
          for (let t = 0; t < 600; t++) {
            const before = performance.now();
            game.executeNextTick();
            ticksMs.push(performance.now() - before);
            if (t % 100 === 0)
              for (const p of game.players()) {
                expect(Number.isFinite(p.troops())).toBe(true);
                expect(p.gold() >= 0n).toBe(true);
              }
          }
          const sorted = game
            .players()
            .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
          const kinds: Record<string, number> = {};
          for (const exec of game.executions())
            if (exec instanceof NationExecution) {
              const goal = exec["objective"];
              if (goal) kinds[goal.kind] = (kinds[goal.kind] ?? 0) + 1;
            }
          const sample = {
            minute,
            alive: sorted.length,
            leader: sorted[0]?.name(),
            leaderTiles: sorted[0]?.numTilesOwned(),
            owned: sorted.reduce((n, p) => n + p.numTilesOwned(), 0),
            cities: game.units(UnitType.City).length,
            ports: game.units(UnitType.Port).length,
            industries: RESOURCE_BUILDINGS.reduce(
              (n, type) => n + game.units(type).length,
              0,
            ),
            attacks: totalAttacks,
            objectives: kinds,
          };
          samples.push(sample);
          fs.appendFileSync(
            output + ".progress",
            JSON.stringify({ seed, ...sample }) + "\n",
          );
          console.log("AUDIT", seed, JSON.stringify(sample));
          if (game.getWinner() !== null) break;
        }
        ticksMs.sort((a, b) => a - b);
        const final = game.allPlayers().map((p) => ({
          country: p.name(),
          alive: p.isAlive(),
          tiles: p.numTilesOwned(),
          gold: p.gold().toString(),
          troops: p.troops(),
          units: p.units().map((u) => [u.type(), u.level(), u.tile()]),
        }));
        const report = {
          seed,
          difficulty,
          enabled,
          sourceFingerprint,
          map: "resources/maps/world",
          nations: nations.length,
          minutes: samples.length,
          wallMs: Math.round(performance.now() - start),
          planMs: Math.round(planMs),
          planCalls,
          tickP95: ticksMs[Math.floor(ticksMs.length * 0.95)],
          tickMax: ticksMs[ticksMs.length - 1],
          friendlyAttacks,
          alliances: alliances / 2,
          byCountry,
          samples,
          events,
          final,
          fingerprint: createHash("sha256")
            .update(JSON.stringify({ events, final }))
            .digest("hex"),
        };
        results.push(report);
        fs.writeFileSync(output, JSON.stringify(results, null, 2));
        expect(friendlyAttacks).toBe(0);
        expect(totalAttacks).toBeGreaterThan(0);
        if (enabled) expect(events.length).toBeGreaterThan(0);
      },
      1_800_000,
    );
});
