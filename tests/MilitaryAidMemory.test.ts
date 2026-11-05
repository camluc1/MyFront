import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { setup, playerInfo } from "./util/Setup";

test("military aid reflects actual relative impact, does not stack tiny gifts, and expires", async () => {
  const game = await setup("plains", { gameType: GameType.Singleplayer }, [
    playerInfo("donor", PlayerType.Human),
    playerInfo("recipient", PlayerType.Nation),
  ]);
  const donor = game.player("donor");
  const recipient = game.player("recipient") as PlayerImpl;
  donor.conquer(game.ref(0, 0));
  recipient.conquer(game.ref(0, 1));
  donor.addTroops(100000);
  recipient.addTroops(20000);
  const before = recipient.troops();
  donor.donateTroops(recipient, before / 2);
  expect(recipient.militaryAidInfluence(donor)).toBeCloseTo(0.1);
  donor.donateTroops(recipient, 1);
  expect(recipient.militaryAidInfluence(donor)).toBeCloseTo(0.1);
  const ticks = vi.spyOn(game, "ticks");
  ticks.mockReturnValue(game.ticks() + 1800);
  expect(recipient.militaryAidInfluence(donor)).toBe(0);
  ticks.mockRestore();
});
