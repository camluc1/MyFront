import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { canBuildTransportShip } from "@openfront/engine/game/TransportShipUtils";
import { describe, expect, it } from "vitest";
import { createGame, L, W } from "../pathfinding/_fixtures";

function addPlayer(game: Game, tile: TileRef, id: string = "test"): Player {
  const info = new PlayerInfo(id, PlayerType.Human, null, `${id}_id`);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, tile));
  game.executeNextTick();
  game.executeNextTick();
  return game.player(info.id);
}

// Target island (cols 10-24, rows 1-16) with an interior lake
// (cols 15-20, rows 6-11) enclosed by a thick land moat, so the lake is a
// separate water component from the ocean. Attacker island on the left.
function buildLakeMap(): Game {
  const width = 26;
  const height = 18;
  const grid: string[] = new Array(width * height).fill(W);
  const set = (x: number, y: number, v: string) => (grid[y * width + x] = v);
  const inBox = (
    x: number,
    y: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
  ) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inBox(x, y, 1, 5, 6, 11)) set(x, y, L); // attacker island
      if (inBox(x, y, 10, 24, 1, 16)) set(x, y, L); // target island (unowned)
      if (inBox(x, y, 15, 20, 6, 11)) set(x, y, W); // carve lake
    }
  }
  return createGame({ width, height, grid });
}

describe("canBuildTransportShip", () => {
  it("allows a transport toward a reachable ocean shore near a lake click", () => {
    const game = buildLakeMap();
    const attacker = addPlayer(game, game.ref(3, 8), "attacker");

    // Click on the (unowned) target island next to the inland lake. The nearest
    // owned shore is lake-facing and unreachable by the attacker's boats, but a
    // reachable ocean-facing shore exists — so the boat must still be buildable.
    const clickNearLake = game.ref(14, 8);
    const src = canBuildTransportShip(game, attacker, clickNearLake);

    expect(src).not.toBe(false);
    expect(game.isShore(src as TileRef)).toBe(true);
    expect((attacker as Player).smallID()).toBe(game.ownerID(src as TileRef));
  });
});


// Deep-island regression: an ocean landing can be much more than 50 tiles
// away from the center of a large island, even though it is reachable.
describe("transport attack on a distant island", () => {
  it("finds an ocean-accessible landing for a click deep inside unclaimed land", () => {
    const width = 135;
    const height = 135;
    const grid = new Array<string>(width * height).fill(W);
    const fill = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          grid[y * width + x] = L;
        }
      }
    };
    fill(1, 7, 61, 69); // attacker-owned island
    fill(14, 128, 6, 130); // much larger unclaimed island
    const game = createGame({ width, height, grid });
    const attacker = addPlayer(game, game.ref(4, 65), "island-attacker");
    const click = game.ref(73, 70);
    // The original fixed 50-tile search failed here, although a boat can sail
    // to the outer shore of this island.
    const source = canBuildTransportShip(game, attacker, click);
    expect(source).not.toBe(false);
    if (source !== false) {
      expect(game.ownerID(source)).toBe(attacker.smallID());
      expect(game.isShore(source)).toBe(true);
    }
  });
});
