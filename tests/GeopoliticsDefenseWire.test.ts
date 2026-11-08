import { GameType, PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { packUnitUpdates, unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

const human = new PlayerInfo("defender", PlayerType.Human, null, "defender");

it("constructs Castle and Iron Dome in Geopolitics without crashing the packed game update", async () => {
  const game = await setup(
    "plains",
    { geopolitics: true, gameType: GameType.Singleplayer, instantBuild: true },
    [human],
  );
  const player = game.player("defender");
  player.addGold(25_000_000n);

  // Two separated owned zones give each structure a valid placement site.
  for (const [cx, cy] of [[25, 25], [70, 70]]) {
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = cx - 4; x <= cx + 4; x++) {
        player.conquer(game.ref(x, y));
      }
    }
  }

  for (const [type, x, y] of [
    [UnitType.Castle, 25, 25],
    [UnitType.IronDome, 70, 70],
  ] as const) {
    const tile = game.ref(x, y);
    expect(player.canBuild(type, tile)).not.toBe(false);
    constructionExecution(game, player, x, y, type, 4);
    expect(player.units(type)).toHaveLength(1);
  }

  const structures = [UnitType.Castle, UnitType.IronDome].map((type) => player.units(type)[0]);
  const packed = packUnitUpdates(structures.map((unit) => unit.toUpdate()));
  const decoded = unpackUnitUpdates(packed.packedUnitUpdates, packed.packedMissileTimers);
  expect(decoded.map((u) => u.unitType)).toEqual([UnitType.Castle, UnitType.IronDome]);
  expect(decoded.every((u) => u.isActive && !u.underConstruction)).toBe(true);

  // In-game Dome level ups must continue to serialize, including their level.
  structures[1].increaseLevel();
  const upgraded = packUnitUpdates([structures[1].toUpdate()]);
  expect(unpackUnitUpdates(upgraded.packedUnitUpdates, upgraded.packedMissileTimers)[0].level).toBe(2);
});

it("keeps Castle and Iron Dome disabled in classic mode", async () => {
  const game = await setup("plains", { geopolitics: false }, [human]);
  const player = game.player("defender");
  player.conquer(game.ref(30, 30));
  player.addGold(20_000_000n);
  expect(player.canBuild(UnitType.Castle, game.ref(30, 30))).toBe(false);
  expect(player.canBuild(UnitType.IronDome, game.ref(30, 30))).toBe(false);
});
