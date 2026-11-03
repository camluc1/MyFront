import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMode,
  GameType,
  Nation,
  PlayerID,
  PlayerType,
  Relation,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  VersionedSchema,
  zNum,
  zPlayerRef,
  zRandom,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever, simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import {
  NationSchema,
  nationData,
  newCell,
  readPlayerInfo,
} from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { NationAllianceBehavior } from "./nation/NationAllianceBehavior";
import { NationAttackBehavior } from "./nation/NationAttackBehavior";
import { NationEmojiBehavior } from "./nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "./nation/NationMIRVBehavior";
import { NationNukeBehavior } from "./nation/NationNukeBehavior";
import { NationStructureBehavior } from "./nation/NationStructureBehavior";
import { NationWarshipBehavior } from "./nation/NationWarshipBehavior";
import { tutorialCollapse } from "./nation/TutorialCollapse";
import { tutorialSilo, tutorialWarship } from "./nation/TutorialSilo";
import { SpawnExecution } from "./SpawnExecution";
import { getNationDoctrine, type NationDoctrine } from "./nation/NationDoctrine";
import { findRunawayLeader } from "./nation/NationUtils";

export class NationExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behaviorsInitialized = false;
  private spawnExecAdded = false;
  private emojiBehavior!: NationEmojiBehavior;
  private mirvBehavior!: NationMIRVBehavior;
  private attackBehavior!: NationAttackBehavior;
  private allianceBehavior!: NationAllianceBehavior;
  private warshipBehavior!: NationWarshipBehavior;
  private nukeBehavior!: NationNukeBehavior;
  private structureBehavior!: NationStructureBehavior;
  private mg: Game;
  private player: Player | null = null;
  private doctrine!: NationDoctrine;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private embargoMalusApplied = new Set<PlayerID>();

  // Persist the strategic intent by smallID so it survives save/load.
  private warPlanTargetSmallID: number | null = null;
  private warPlanReviewTick = 0;
  private warPlanExpiresTick = 0;

  constructor(
    private gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.Nation
  ) {
    this.doctrine = getNationDoctrine(
      nation.playerInfo.nationFlag,
      nation.playerInfo.name,
    );
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.triggerRatio = Math.min(
      0.7,
      Math.max(
        0.1,
        this.random.nextInt(50, 60) / 100 + this.doctrine.triggerRatioOffset,
      ),
    );
    this.reserveRatio = Math.min(
      0.6,
      Math.max(
        0.1,
        this.random.nextInt(30, 40) / 100 + this.doctrine.reserveRatioOffset,
      ),
    );
    this.expandRatio = Math.min(
      0.35,
      Math.max(
        0.05,
        this.random.nextInt(10, 20) / 100 + this.doctrine.expandRatioOffset,
      ),
    );
  }

  init(mg: Game) {
    this.mg = mg;
    this.attackRate = this.getAttackRate();
    this.attackTick = this.random.nextInt(0, this.attackRate);

    if (!this.mg.hasPlayer(this.nation.playerInfo.id)) {
      this.player = this.mg.addPlayer(this.nation.playerInfo);
    } else {
      this.player = this.mg.player(this.nation.playerInfo.id);
    }
  }

  private getAttackRate(): number {
    const { difficulty, gameType } = this.mg.config().gameConfig();
    const singleplayer = gameType === GameType.Singleplayer;
    switch (difficulty) {
      case Difficulty.Easy:
        return Math.max(
          20,
          Math.round(
            this.random.nextInt(65, 100) *
              this.doctrine.attackCadenceMultiplier,
          ),
        ); // Slower reactions.
      case Difficulty.Medium:
        return Math.max(
          20,
          Math.round(
            this.random.nextInt(
              singleplayer ? 80 : 55,
              singleplayer ? 105 : 70,
            ) * this.doctrine.attackCadenceMultiplier,
          ),
        );
      case Difficulty.Hard:
        return Math.max(
          20,
          Math.round(
            this.random.nextInt(45, 60) * this.doctrine.attackCadenceMultiplier,
          ),
        );
      case Difficulty.Impossible:
        return Math.max(
          20,
          Math.round(
            this.random.nextInt(30, 50) * this.doctrine.attackCadenceMultiplier,
          ),
        ); // Faster reactions
      default:
        assertNever(difficulty);
    }
  }

  tick(ticks: number) {
    // Ship tracking
    if (
      this.behaviorsInitialized &&
      this.player !== null &&
      this.player.isAlive() &&
      this.mg.config().gameConfig().difficulty !== Difficulty.Easy &&
      !this.mg.config().gameConfig().tutorial &&
      this.player.unitsConstructed(UnitType.Port) &&
      !this.mg.config().isUnitDisabled(UnitType.Warship)
    ) {
      this.warshipBehavior.trackShipsAndRetaliate();
    }

    if (this.player === null) {
      return;
    }

    if (this.mg.inSpawnPhase()) {
      if (this.player.hasSpawned()) {
        // Already on the map — periodically re-spawn so the nation
        // visibly hops to different locations during the spawn phase.
        if (ticks % this.attackRate !== this.attackTick) {
          return;
        }
      } else if (this.spawnExecAdded) {
        // First SpawnExecution already queued, wait for it to land.
        return;
      }
      // Place nations without a spawn cell (Dynamically created for HumansVsNations) randomly by SpawnExecution
      if (this.nation.spawnCell === undefined) {
        this.mg.addExecution(
          new SpawnExecution(this.gameID, this.nation.playerInfo),
        );
        this.spawnExecAdded = true;
        return;
      }

      // If team spawn areas are configured and the nation's spawn cell
      // is outside its team's area, spawn randomly within the area instead.
      const team = this.player.team();
      if (team !== null) {
        const area = this.mg.teamSpawnArea(team);
        if (area !== undefined) {
          const cell = this.nation.spawnCell;
          const inArea =
            cell.x >= area.x &&
            cell.x < area.x + area.width &&
            cell.y >= area.y &&
            cell.y < area.y + area.height;
          if (!inArea) {
            this.mg.addExecution(
              new SpawnExecution(this.gameID, this.nation.playerInfo),
            );
            this.spawnExecAdded = true;
            return;
          }
        }
      }

      // Select a tile near the position defined in the map manifest
      const rl = this.randomSpawnLand();

      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }

      this.mg.addExecution(
        new SpawnExecution(this.gameID, this.nation.playerInfo, rl),
      );
      this.spawnExecAdded = true;
      return;
    }

    // Spawn phase already ended but our SpawnExecution hasn't fired yet — wait.
    if (this.spawnExecAdded && !this.player.hasSpawned()) {
      return;
    }

    if (!this.player.isAlive()) {
      //removeOnDeath is called from nation's PlayerExecution
      this.active = false;
      return;
    }

    if (!this.behaviorsInitialized) {
      this.initializeBehaviors();
      this.attackBehavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    // The tutorial's nations only grow into free land, and the one on the
    // player's island nukes them from its silo (TutorialSilo): no attacks,
    // boats, alliances or other structures. Each falls once the player has
    // taken most of it (TutorialCollapse).
    if (this.mg.config().gameConfig().tutorial) {
      tutorialCollapse(this.mg, this.player);
      if (!this.player.isAlive()) return;
      const attackTick = ticks % this.attackRate === this.attackTick;
      if (attackTick) this.attackBehavior.expandIntoFreeLand();
      tutorialSilo(this.mg, this.player, attackTick);
      tutorialWarship(this.mg, this.player, ticks);
      return;
    }

    this.attackBehavior.followUpLandings();
    this.nukeBehavior.followUpStrikes();

    if (ticks % this.attackRate !== this.attackTick) {
      // Call handleStructures twice between regular attack ticks (at 1/3 and 2/3 of the interval)
      // Otherwise it is possible that we earn more gold than we can spend
      // The alternative is placing multiple structures in handleStructures, but that causes problems
      if (this.player.isAlive()) {
        const offset = ticks % this.attackRate;
        const oneThird =
          (this.attackTick + Math.floor(this.attackRate / 3)) % this.attackRate;
        const twoThirds =
          (this.attackTick + Math.floor((this.attackRate * 2) / 3)) %
          this.attackRate;
        if (offset === oneThird || offset === twoThirds) {
          this.structureBehavior.handleStructures();
        }
      }
      return;
    }

    this.emojiBehavior.maybeSendCasualEmoji();
    this.updateRelationsFromEmbargos();
    this.allianceBehavior.handleAllianceRequests();
    this.allianceBehavior.handleAllianceExtensionRequests();
    this.mirvBehavior.considerMIRV();
    this.structureBehavior.handleStructures();
    this.warshipBehavior.maybeSpawnWarship();
    this.handleEmbargoesToHostileNations();
    this.updateWarPlan(ticks);
    this.attackBehavior.setStrategicTarget(this.currentWarPlanTarget());
    this.attackBehavior.maybeAttack();
    this.warshipBehavior.counterWarshipInfestation();
    this.nukeBehavior.maybeSendNuke();
  }

  private initializeBehaviors(): void {
    if (this.player === null) throw new Error("Player not initialized");

    this.emojiBehavior = new NationEmojiBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.mirvBehavior = new NationMIRVBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.allianceBehavior = new NationAllianceBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
      this.doctrine,
    );
    this.warshipBehavior = new NationWarshipBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.attackBehavior = new NationAttackBehavior(
      this.random,
      this.mg,
      this.player,
      this.triggerRatio,
      this.reserveRatio,
      this.expandRatio,
      this.allianceBehavior,
      this.emojiBehavior,
      this.warshipBehavior,
      this.doctrine,
    );
    this.nukeBehavior = new NationNukeBehavior(
      this.random,
      this.mg,
      this.player,
      this.attackBehavior,
      this.emojiBehavior,
    );
    this.structureBehavior = new NationStructureBehavior(
      this.random,
      this.mg,
      this.player,
      this.doctrine,
    );
    this.behaviorsInitialized = true;
  }

  private randomSpawnLand(): TileRef | null {
    if (this.nation.spawnCell === undefined) throw new Error("not initialized");

    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        this.mg.isLand(tile) &&
        !this.mg.hasOwner(tile) &&
        !this.mg.isImpassable(tile)
      ) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  /**
   * Select a medium-term opponent for single-player campaigns. This is an
   * intent layer only; NationAttackBehavior continues to enforce its original
   * reserves, reachability, retaliation and transport rules.
   */
  private updateWarPlan(ticks: number): void {
    const config = this.mg.config().gameConfig();
    if (
      this.player === null ||
      config.gameType !== GameType.Singleplayer ||
      config.difficulty === Difficulty.Easy
    ) {
      this.warPlanTargetSmallID = null;
      this.warPlanReviewTick = ticks + 300;
      this.warPlanExpiresTick = 0;
      return;
    }

    if (ticks < this.warPlanReviewTick) return;
    this.warPlanReviewTick = ticks + 300;

    const current = this.currentWarPlanTarget();
    if (current !== null && ticks < this.warPlanExpiresTick) return;

    const player = this.player;
    const ownTiles = Math.max(1, player.numTilesOwned());
    const ownCapacity = this.mg.config().maxTroops(player);
    const ownStrength = Math.max(1, player.troops() + ownCapacity * 0.15);
    const runawayLeader = findRunawayLeader(this.mg);
    const candidates = player.nearby().filter(
      (candidate): candidate is Player =>
        candidate.isPlayer() &&
        candidate !== player &&
        candidate.isAlive() &&
        candidate.type() !== PlayerType.Bot &&
        !player.isFriendly(candidate),
    );

    let best: Player | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const capacity = this.mg.config().maxTroops(candidate);
      const committed = candidate
        .outgoingAttacks()
        .reduce((sum, attack) => sum + attack.troops(), 0);
      const exposedRatio = Math.min(
        1,
        committed / Math.max(1, candidate.troops() + committed),
      );
      const effectiveStrength = Math.max(
        1,
        candidate.troops() + capacity * 0.15 - committed * 0.2,
      );
      const relativeStrength = ownStrength / effectiveStrength;

      // Avoid choosing a clearly stronger hegemon as an offensive campaign.
      if (candidate === runawayLeader && relativeStrength < 0.9) continue;
      if (relativeStrength < 0.55) continue;

      const territoryValue = Math.min(
        2,
        candidate.numTilesOwned() / ownTiles,
      );
      const borderBonus = player.sharesBorderWith(candidate) ? 12 : 0;
      const hostileBonus =
        player.relation(candidate) <= Relation.Hostile ? 5 : 0;
      const leaderBonus = candidate === runawayLeader ? 10 : 0;
      const score =
        Math.min(3, relativeStrength) * 20 +
        territoryValue * 7 +
        exposedRatio * 9 +
        borderBonus +
        hostileBonus +
        leaderBonus;

      if (
        score > bestScore ||
        (score === bestScore &&
          best !== null &&
          candidate.smallID() < best.smallID())
      ) {
        best = candidate;
        bestScore = score;
      }
    }

    this.warPlanTargetSmallID =
      best !== null && bestScore >= 24 ? best.smallID() : null;
    this.warPlanExpiresTick = ticks + 900;
  }

  private currentWarPlanTarget(): Player | null {
    if (this.player === null || this.warPlanTargetSmallID === null) {
      return null;
    }
    const target = this.mg.playerBySmallID(this.warPlanTargetSmallID);
    return target.isPlayer() &&
      target.isAlive() &&
      !this.player.isFriendly(target)
      ? target
      : null;
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasManualEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasManualEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());
    const difficulty = this.mg.config().gameConfig().difficulty;
    const isHigherDifficulty =
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;
    const teamGame = this.mg.config().gameConfig().gameMode === GameMode.Team;

    others.forEach((other: Player) => {
      // In team games on higher difficulties, refuse to trade with anyone
      // not on this nation's team.
      if (
        teamGame &&
        isHigherDifficulty &&
        other.type() !== PlayerType.Bot &&
        !player.isOnSameTeam(other)
      ) {
        if (!player.hasEmbargoAgainst(other)) {
          player.addEmbargo(other, false);
        }
        return;
      }

      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other) &&
        !player.isOnSameTeam(other)
      ) {
        player.addEmbargo(other, false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other) &&
        difficulty !== Difficulty.Hard &&
        difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      } else if (
        player.relation(other) >= Relation.Friendly &&
        player.hasEmbargoAgainst(other) &&
        difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    // The nation is normally one of the game's own; store it by index so
    // identity survives. Dynamically created nations are stored inline.
    const nationIndex = w.game.nations().indexOf(this.nation);
    return NationExecutionSnapshot.write({
      active: this.active,
      gameID: this.gameID,
      nationIndex: nationIndex === -1 ? null : nationIndex,
      nation: nationIndex === -1 ? nationData(this.nation) : null,
      random: w.random(this.random),
      initialized: this.mg !== undefined,
      player: w.playerOrNull(this.player),
      attackRate: this.attackRate ?? null,
      attackTick: this.attackTick ?? null,
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
      embargoMalusApplied: [...this.embargoMalusApplied],
      warPlanTargetSmallID: this.warPlanTargetSmallID,
      warPlanReviewTick: this.warPlanReviewTick,
      warPlanExpiresTick: this.warPlanExpiresTick,
      spawnExecAdded: this.spawnExecAdded,
      behaviors: this.behaviorsInitialized
        ? {
            emoji: this.emojiBehavior.snapshot(w),
            mirv: this.mirvBehavior.snapshot(w),
            alliance: this.allianceBehavior.snapshot(w),
            warship: this.warshipBehavior.snapshot(w),
            attack: this.attackBehavior.snapshot(w),
            nuke: this.nukeBehavior.snapshot(w),
            structure: this.structureBehavior.snapshot(w),
          }
        : null,
    });
  }

  restoreSnapshot(s: NationState, r: SnapshotReader): void {
    this.active = s.active;
    this.gameID = s.gameID;
    if (s.nationIndex !== null) {
      this.nation = r.game.nations()[s.nationIndex];
    } else if (s.nation !== null) {
      const cell = s.nation.spawnCell;
      this.nation = new Nation(
        cell === null ? undefined : newCell(cell),
        readPlayerInfo(s.nation.playerInfo, r),
      );
    }
    this.doctrine = getNationDoctrine(
      this.nation.playerInfo.nationFlag,
      this.nation.playerInfo.name,
    );
    // One PRNG shared with every behavior, as in a live game.
    const random = r.random(s.random);
    this.random = random;
    if (s.initialized) this.mg = r.game;
    this.player = r.playerOrNull(s.player);
    if (s.attackRate !== null) this.attackRate = s.attackRate;
    if (s.attackTick !== null) this.attackTick = s.attackTick;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
    this.embargoMalusApplied = new Set(s.embargoMalusApplied);
    this.warPlanTargetSmallID = s.warPlanTargetSmallID;
    this.warPlanReviewTick = s.warPlanReviewTick;
    this.warPlanExpiresTick = s.warPlanExpiresTick;
    this.spawnExecAdded = s.spawnExecAdded;
    this.behaviorsInitialized = s.behaviors !== null;
    const b = s.behaviors;
    const player = this.player;
    if (b === null || player === null) return;
    const shell = <T extends object>(cls: { prototype: T }): T =>
      Object.create(cls.prototype) as T;
    const emoji = shell(NationEmojiBehavior);
    const mirv = shell(NationMIRVBehavior);
    const alliance = shell(NationAllianceBehavior);
    const warship = shell(NationWarshipBehavior);
    const attack = shell(NationAttackBehavior);
    const nuke = shell(NationNukeBehavior);
    const structure = shell(NationStructureBehavior);
    emoji.restoreSnapshot(b.emoji, r, random, player);
    mirv.restoreSnapshot(b.mirv, r, random, player, emoji);
    alliance.restoreSnapshot(b.alliance, r, random, player, emoji, this.doctrine);
    warship.restoreSnapshot(b.warship, r, random, player, emoji);
    attack.restoreSnapshot(
      b.attack,
      r,
      random,
      player,
      alliance,
      emoji,
      warship,
      this.doctrine,
    );
    nuke.restoreSnapshot(b.nuke, r, random, player, attack, emoji);
    structure.restoreSnapshot(b.structure, r, random, player, this.doctrine);
    this.emojiBehavior = emoji;
    this.mirvBehavior = mirv;
    this.allianceBehavior = alliance;
    this.warshipBehavior = warship;
    this.attackBehavior = attack;
    this.nukeBehavior = nuke;
    this.structureBehavior = structure;
  }
}

// Each behavior is its own versioned record, so its layout can change
// without bumping this one.
const NationStateSchema = z.object({
  active: z.boolean(),
  gameID: z.string(),
  nationIndex: z.number().int().nonnegative().nullable(),
  nation: NationSchema.nullable(),
  random: zRandom(),
  initialized: z.boolean(),
  player: zPlayerRef().nullable(),
  attackRate: zNum().nullable(),
  attackTick: zNum().nullable(),
  triggerRatio: zNum(),
  reserveRatio: zNum(),
  expandRatio: zNum(),
  embargoMalusApplied: z.array(z.string()),
  warPlanTargetSmallID: zPlayerRef().nullable(),
  warPlanReviewTick: zNum(),
  warPlanExpiresTick: zNum(),
  spawnExecAdded: z.boolean(),
  behaviors: z
    .object({
      emoji: VersionedSchema,
      mirv: VersionedSchema,
      alliance: VersionedSchema,
      warship: VersionedSchema,
      attack: VersionedSchema,
      nuke: VersionedSchema,
      structure: VersionedSchema,
    })
    .nullable(),
});
type NationState = z.infer<typeof NationStateSchema>;

export const NationExecutionSnapshot = execSnapshotType({
  name: "Nation",
  version: 2,
  schema: NationStateSchema,
  migrations: {
    1: (data) => ({
      ...data,
      warPlanTargetSmallID: null,
      warPlanReviewTick: 0,
      warPlanExpiresTick: 0,
    }),
  },
  cls: () => NationExecution,
});
