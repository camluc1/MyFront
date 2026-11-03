import {
  Difficulty,
  GameType,
  PlayerType,
  TerraNullius,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Versioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Player } from "../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

/**
 * Difficulty profiles for map tribes (PlayerType.Bot).
 *
 * Easy intentionally preserves the original tuning. The other profiles
 * change decision cadence and troop commitment, not the combat rules.
 * Ranges are [min, max), matching PseudoRandom.nextInt().
 */
export interface TribeAIDifficultyProfile {
  attackRate: readonly [number, number];
  triggerRatio: readonly [number, number];
  reserveRatio: readonly [number, number];
  expandRatio: readonly [number, number];
}

export const TRIBE_AI_DIFFICULTY_PROFILES: Readonly<
  Record<Difficulty, TribeAIDifficultyProfile>
> = {
  [Difficulty.Easy]: {
    attackRate: [40, 80],
    triggerRatio: [50, 60],
    reserveRatio: [30, 40],
    expandRatio: [10, 20],
  },
  [Difficulty.Medium]: {
    attackRate: [55, 80],
    triggerRatio: [42, 52],
    reserveRatio: [24, 33],
    expandRatio: [8, 16],
  },
  [Difficulty.Hard]: {
    attackRate: [24, 42],
    triggerRatio: [35, 45],
    reserveRatio: [18, 27],
    expandRatio: [6, 13],
  },
  [Difficulty.Impossible]: {
    attackRate: [18, 34],
    triggerRatio: [29, 39],
    reserveRatio: [14, 22],
    expandRatio: [4, 10],
  },
};

/** Multiplayer bot behavior stays on the legacy Easy profile. */
export function getTribeAIDifficulty(
  gameConfig: Pick<GameConfig, "gameType" | "difficulty">,
): Difficulty {
  return gameConfig.gameType === GameType.Singleplayer
    ? gameConfig.difficulty
    : Difficulty.Easy;
}

export class TribeAttackBehavior extends AiAttackBehavior {
  snapshot(w: SnapshotWriter): Versioned {
    return this.writeRecord(w, 0, []);
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    this.restoreRecord(raw, r, random, player);
  }

  override shouldAttack(other: Player | TerraNullius): boolean {
    const { gameType, difficulty } = this.game.config().gameConfig();
    if (
      gameType !== GameType.Singleplayer ||
      difficulty !== Difficulty.Easy && difficulty !== Difficulty.Medium ||
      !other.isPlayer() ||
      this.player.sharesBorderWith(other)
    ) {
      return true;
    }

    // Overseas attacks remain part of the game, but Easy and Normal tribes
    // must build a meaningful reserve before committing to a distant landing.
    const requiredReserve =
      difficulty === Difficulty.Easy ? 0.65 : 0.75;
    const capacity = Math.max(1, this.game.config().maxTroops(this.player));
    return this.player.troops() / capacity >= requiredReserve;
  }

  attackRandomTarget() {
    const difficulty = getTribeAIDifficulty(this.game.config().gameConfig());

    // Preserve the original Easy model, including its random target order and
    // its exact decision sequence. Existing Easy saves therefore retain their
    // established behavior.
    if (difficulty === Difficulty.Easy) {
      this.attackRandomTargetEasy();
      return;
    }

    const incomingAttackPlayer = this.findIncomingAttackPlayer();

    // Hard and Impossible tribes react before they have banked the normal
    // attack threshold. Their lower reserve ratios still prevent empty attacks.
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      incomingAttackPlayer !== null &&
      this.sendAttack(incomingAttackPlayer, true)
    ) {
      return;
    }

    // Normal and higher still build a force before initiating new campaigns.
    if (!this.hasTriggerRatioTroops()) return;

    // Once the threshold is reached, answer an incoming attack before choosing
    // a fresh target.
    if (
      incomingAttackPlayer !== null &&
      this.sendAttack(incomingAttackPlayer, true)
    ) {
      return;
    }

    const traitor = this.getNeighborTraitorToAttack();
    if (
      traitor !== null &&
      (difficulty !== Difficulty.Medium || this.random.chance(12)) &&
      this.sendAttack(traitor)
    ) {
      return;
    }

    // Normal favors nearby bot territories. Hard and Impossible evaluate
    // enemy strength, exposed armies and territory value before committing.
    for (const target of this.selectStrategicTargets(difficulty)) {
      if (this.sendAttack(target)) return;
    }
  }

  private attackRandomTargetEasy() {
    // Original behavior kept intact for Easy.
    if (!this.hasTriggerRatioTroops()) return;

    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      if (this.sendAttack(incomingAttackPlayer, true)) return;
    }

    const toAttack = this.getNeighborTraitorToAttack();
    if (toAttack !== null && this.random.chance(3)) {
      if (this.sendAttack(toAttack)) return;
    }

    const neighbors = this.player.nearby();
    for (const neighbor of this.random.shuffleArray(neighbors)) {
      if (!neighbor.isPlayer()) continue;
      if (this.player.isFriendly(neighbor)) continue;
      if (
        neighbor.type() === PlayerType.Nation ||
        neighbor.type() === PlayerType.Human
      ) {
        if (this.random.chance(2)) continue;
      }
      if (this.sendAttack(neighbor)) return;
    }
  }

  private selectStrategicTargets(difficulty: Difficulty): Player[] {
    const ownTroops = Math.max(1, this.player.troops());
    const candidates = this.player.nearby().filter(
      (neighbor): neighbor is Player =>
        neighbor.isPlayer() &&
        neighbor.isAlive() &&
        !this.player.isFriendly(neighbor),
    );

    const score = (target: Player): number => {
      const incomingTroops = target
        .incomingAttacks()
        .reduce((total, attack) => total + attack.troops(), 0);

      if (difficulty === Difficulty.Medium) {
        // A modest bot preference helps Normal expand through the map's
        // weaker fillers without blindly ignoring a clearly weaker opponent.
        const botPriority =
          target.type() === PlayerType.Bot ? ownTroops * 0.25 : 0;
        const pressureBonus = Math.min(ownTroops * 0.1, incomingTroops * 0.25);
        return target.troops() - botPriority - pressureBonus;
      }

      // Higher difficulties exploit targets whose armies are already engaged,
      // while accounting for the strength and density of the remaining force.
      const exposedTroops = Math.max(
        0,
        target.troops() - incomingTroops * 0.5,
      );
      const troopDensity =
        target.troops() / Math.max(1, target.numTilesOwned());
      const territoryValue = Math.min(
        ownTroops * 0.12,
        target.numTilesOwned() * 10,
      );
      return exposedTroops + troopDensity * 8 - territoryValue;
    };

    return candidates.sort((a, b) => {
      const difference = score(a) - score(b);
      if (difference !== 0) return difference;
      // Explicit stable tie-break keeps decisions deterministic across clients.
      return a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0;
    });
  }

  // Allies only for a caller that breaks the alliance before attacking
  getNeighborTraitorToAttack(includeAllies = false): Player | null {
    if (this.game.config().disableAlliances()) return null;

    const traitors = this.player
      .nearby()
      .filter(
        (n): n is Player =>
          n.isPlayer() &&
          (includeAllies || !this.player.isFriendly(n)) &&
          n.isTraitor(),
      );
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
  }
}
