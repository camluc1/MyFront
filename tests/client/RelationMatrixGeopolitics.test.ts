import { expect, it } from "vitest";
import { buildRelationMatrix } from "../../src/client/render/frame/derive/RelationMatrix";
import type { PlayerState } from "../../src/client/render/types";

function player(
  smallID: number,
  incomingAttacks: { attackerID: number; retreating: boolean }[] = [],
): PlayerState {
  return {
    smallID,
    incomingAttacks,
    allies: [],
    embargoes: [],
  } as unknown as PlayerState;
}

it("marks active war borders hostile only in Geopolitics", () => {
  const players = new Map<number, PlayerState>([
    [1, player(1)],
    [2, player(2, [{ attackerID: 1, retreating: false }])],
  ]);
  const classic = buildRelationMatrix(players);
  expect(classic.matrix[1 * classic.size + 2]).toBe(0);
  expect(classic.matrix[2 * classic.size + 1]).toBe(0);

  const geopolitics = buildRelationMatrix(players, undefined, true);
  expect(geopolitics.matrix[1 * geopolitics.size + 2]).toBe(3);
  expect(geopolitics.matrix[2 * geopolitics.size + 1]).toBe(3);
});

it("does not mark a retreating attack as an active hostile border", () => {
  const players = new Map<number, PlayerState>([
    [1, player(1)],
    [2, player(2, [{ attackerID: 1, retreating: true }])],
  ]);
  const result = buildRelationMatrix(players, undefined, true);
  expect(result.matrix[1 * result.size + 2]).toBe(0);
});

it("keeps hostility stronger than an existing friendly relation", () => {
  const attacker = player(1);
  const defender = player(2, [{ attackerID: 1, retreating: false }]);
  attacker.allies = [2];
  defender.allies = [1];
  const result = buildRelationMatrix(
    new Map<number, PlayerState>([[1, attacker], [2, defender]]),
    undefined,
    true,
  );
  expect(result.matrix[1 * result.size + 2]).toBe(3);
  expect(result.matrix[2 * result.size + 1]).toBe(3);
});
