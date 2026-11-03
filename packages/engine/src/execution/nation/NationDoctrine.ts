/**
 * Stable single-player country personalities.
 *
 * Doctrines tune the priorities of the existing nation AI. They do not replace
 * its attack, naval, diplomacy, or construction systems, and every doctrine
 * keeps a positive incentive to expand.
 */
export type NationAttackStrategy =
  | "retaliate"
  | "bots"
  | "assist"
  | "traitor"
  | "afk"
  | "betray"
  | "nuked"
  | "victim"
  | "juicy"
  | "hated"
  | "veryWeak"
  | "weakest"
  | "island"
  | "donate"
  | "crown";

export type NationStructurePreference =
  | "balanced"
  | "industry"
  | "military";

export type NationDoctrineId =
  | "imperialist"
  | "militarist"
  | "strategist"
  | "opportunist"
  | "industrialist"
  | "diplomatic"
  | "survivor";

export interface NationDoctrine {
  readonly id: NationDoctrineId;
  /** Multiplies the nation's normal decision interval; lower means faster. */
  readonly attackCadenceMultiplier: number;
  /** Additive adjustments to the normal troop commitment ratios. */
  readonly triggerRatioOffset: number;
  readonly reserveRatioOffset: number;
  /** Negative values retain fewer troops at home when expanding into free land or weak bots. */
  readonly expandRatioOffset: number;
  /** Multiplies the existing low-probability overseas attack checks. */
  readonly navalAttackMultiplier: number;
  /** Chance to request an alliance with each eligible border opponent. */
  readonly allianceRequestChance: number;
  readonly structurePreference: NationStructurePreference;
  /** Moves these existing strategies ahead of the difficulty's default order. */
  readonly preferredAttackStrategies: readonly NationAttackStrategy[];
}

const DOCTRINES: Readonly<Record<NationDoctrineId, NationDoctrine>> = {
  imperialist: {
    id: "imperialist",
    attackCadenceMultiplier: 0.9,
    triggerRatioOffset: -0.04,
    reserveRatioOffset: -0.02,
    expandRatioOffset: -0.025,
    navalAttackMultiplier: 1.05,
    allianceRequestChance: 18,
    structurePreference: "balanced",
    preferredAttackStrategies: [
      "weakest",
      "victim",
      "crown",
      "island",
      "bots",
    ],
  },
  militarist: {
    id: "militarist",
    attackCadenceMultiplier: 0.86,
    triggerRatioOffset: -0.025,
    reserveRatioOffset: 0,
    expandRatioOffset: -0.015,
    navalAttackMultiplier: 1,
    allianceRequestChance: 12,
    structurePreference: "military",
    preferredAttackStrategies: [
      "hated",
      "traitor",
      "retaliate",
      "veryWeak",
      "weakest",
    ],
  },
  strategist: {
    id: "strategist",
    attackCadenceMultiplier: 0.98,
    triggerRatioOffset: -0.01,
    reserveRatioOffset: 0.01,
    expandRatioOffset: -0.01,
    navalAttackMultiplier: 0.9,
    allianceRequestChance: 24,
    structurePreference: "balanced",
    preferredAttackStrategies: ["veryWeak", "juicy", "victim", "crown"],
  },
  opportunist: {
    id: "opportunist",
    attackCadenceMultiplier: 0.88,
    triggerRatioOffset: -0.05,
    reserveRatioOffset: -0.015,
    expandRatioOffset: -0.02,
    navalAttackMultiplier: 1.1,
    allianceRequestChance: 20,
    structurePreference: "balanced",
    preferredAttackStrategies: [
      "afk",
      "veryWeak",
      "victim",
      "juicy",
      "weakest",
    ],
  },
  industrialist: {
    id: "industrialist",
    attackCadenceMultiplier: 1.02,
    triggerRatioOffset: 0.01,
    reserveRatioOffset: 0.02,
    expandRatioOffset: -0.015,
    navalAttackMultiplier: 0.75,
    allianceRequestChance: 26,
    structurePreference: "industry",
    preferredAttackStrategies: ["bots", "victim", "weakest", "juicy"],
  },
  diplomatic: {
    id: "diplomatic",
    attackCadenceMultiplier: 1,
    triggerRatioOffset: -0.015,
    reserveRatioOffset: 0,
    expandRatioOffset: -0.015,
    navalAttackMultiplier: 0.8,
    allianceRequestChance: 42,
    structurePreference: "balanced",
    preferredAttackStrategies: [
      "assist",
      "traitor",
      "weakest",
      "victim",
      "betray",
    ],
  },
  survivor: {
    id: "survivor",
    attackCadenceMultiplier: 1.04,
    triggerRatioOffset: 0.005,
    reserveRatioOffset: 0.03,
    expandRatioOffset: -0.005,
    navalAttackMultiplier: 0.75,
    allianceRequestChance: 14,
    structurePreference: "balanced",
    preferredAttackStrategies: [
      "retaliate",
      "veryWeak",
      "hated",
      "weakest",
    ],
  },
};

// Keep direct/legacy behavior-class callers on the original OpenFront tuning.
// NationExecution always supplies a resolved country doctrine explicitly.
export const DEFAULT_NATION_DOCTRINE: NationDoctrine = {
  id: "strategist",
  attackCadenceMultiplier: 1,
  triggerRatioOffset: 0,
  reserveRatioOffset: 0,
  expandRatioOffset: 0,
  navalAttackMultiplier: 1,
  allianceRequestChance: 30,
  structurePreference: "balanced",
  preferredAttackStrategies: [],
};
export const NATION_DOCTRINE_PROFILES: readonly NationDoctrine[] =
  Object.values(DOCTRINES);

/**
 * Curated identities use the same doctrine on every map. The assignments are
 * gameplay roles, not claims about real countries; all unlisted flags receive
 * a stable role from their flag code.
 */
const FLAG_DOCTRINES: Readonly<Record<string, NationDoctrineId>> = {
  us: "imperialist",
  br: "imperialist",
  in: "imperialist",
  es: "imperialist",
  ru: "militarist",
  ir: "militarist",
  tr: "militarist",
  sa: "militarist",
  de: "industrialist",
  cn: "industrialist",
  it: "opportunist",
  mx: "opportunist",
  fr: "diplomatic",
  ie: "diplomatic",
  gb: "diplomatic",
  "gb-eng": "diplomatic",
  "gb-sct": "diplomatic",
  "gb-wls": "diplomatic",
  northern_ireland: "diplomatic",
  au: "strategist",
  nz: "strategist",
  jp: "militarist",
  ca: "strategist",
  no: "strategist",
  se: "strategist",
  ch: "strategist",
  pl: "survivor",
  ar: "survivor",
  ua: "survivor",
  fi: "survivor",
};

const DOCTRINE_IDS = Object.keys(DOCTRINES) as NationDoctrineId[];

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Resolves a nation's doctrine without consuming the simulation PRNG.
 * Flag codes take precedence so the same country keeps its identity across
 * maps; generated nations fall back to a normalized, stable name.
 */
export function getNationDoctrine(
  nationFlag: string | null | undefined,
  nationName: string,
): NationDoctrine {
  const flag = nationFlag?.trim().toLowerCase();
  const name = nationName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const identity = flag || name || "unknown-nation";
  const id =
    FLAG_DOCTRINES[identity] ??
    DOCTRINE_IDS[stableHash(identity) % DOCTRINE_IDS.length];
  return DOCTRINES[id];
}
