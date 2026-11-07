import type { PlayerState } from "../../types";

const RELATION_SIZE = 1024;
const RELATION_NEUTRAL = 0;
const RELATION_FRIENDLY = 1;
const RELATION_EMBARGO = 2;
const RELATION_HOSTILE = 3;

/** Reusable matrix buffer — one allocation, rewritten each frame. */
const matrix = new Uint8Array(RELATION_SIZE * RELATION_SIZE);

export interface RelationMatrixResult {
  matrix: Uint8Array;
  size: number;
}

/**
 * Build a relationship matrix from player alliance, embargo, and team data.
 * Indexed by `[ownerA * size + ownerB]` → 0=neutral, 1=friendly, 2=embargo, 3=active hostilities.
 * Embargo and active hostilities override friendly; hostilities are enabled only in Geopolitics.
 *
 * @param teams  Optional smallID→team map. Same-team players are marked friendly.
 */
export function buildRelationMatrix(
  players: ReadonlyMap<number, PlayerState>,
  teams?: ReadonlyMap<number, string>,
  geopolitics = false,
): RelationMatrixResult {
  matrix.fill(RELATION_NEUTRAL);

  // Teammates — mark same-team pairs as friendly (before embargoes, which override)
  if (teams && teams.size > 0) {
    const byTeam = new Map<string, number[]>();
    for (const [sid, team] of teams) {
      if (sid <= 0 || sid >= RELATION_SIZE) continue;
      let bucket = byTeam.get(team);
      if (!bucket) {
        bucket = [];
        byTeam.set(team, bucket);
      }
      bucket.push(sid);
    }
    for (const members of byTeam.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!,
            b = members[j]!;
          matrix[a * RELATION_SIZE + b] = RELATION_FRIENDLY;
          matrix[b * RELATION_SIZE + a] = RELATION_FRIENDLY;
        }
      }
    }
  }

  // Alliances
  for (const ps of players.values()) {
    const sid = ps.smallID;
    if (sid <= 0 || sid >= RELATION_SIZE) continue;

    if (ps.allies) {
      for (const allyID of ps.allies) {
        if (allyID > 0 && allyID < RELATION_SIZE) {
          const ab = sid * RELATION_SIZE + allyID;
          const ba = allyID * RELATION_SIZE + sid;
          if (matrix[ab]! < RELATION_FRIENDLY) matrix[ab] = RELATION_FRIENDLY;
          if (matrix[ba]! < RELATION_FRIENDLY) matrix[ba] = RELATION_FRIENDLY;
        }
      }
    }

    if (ps.embargoes) {
      for (const eID of ps.embargoes) {
        if (eID > 0 && eID < RELATION_SIZE) {
          matrix[sid * RELATION_SIZE + eID] = RELATION_EMBARGO;
          matrix[eID * RELATION_SIZE + sid] = RELATION_EMBARGO;
        }
      }
    }
  }

  if (geopolitics) {
    // Mark both sides of every active front. This runs only in Geopolitics;
    // Classic retains its original alliance/embargo border treatment.
    for (const ps of players.values()) {
      const defender = ps.smallID;
      if (defender <= 0 || defender >= RELATION_SIZE) continue;
      for (const attack of ps.incomingAttacks ?? []) {
        const attacker = attack.attackerID;
        if (attack.retreating || attacker <= 0 || attacker >= RELATION_SIZE) continue;
        matrix[defender * RELATION_SIZE + attacker] = RELATION_HOSTILE;
        matrix[attacker * RELATION_SIZE + defender] = RELATION_HOSTILE;
      }
    }
  }

  return { matrix, size: RELATION_SIZE };
}
