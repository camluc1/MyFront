import type { GameMap } from "@openfront/engine-api/game/GameMap";

/** Resource design profiles for all nation/region entries in the world map.
 * NOT active gameplay or geographic deposits. Ownership MUST NOT determine geology.
 * The next stage must author sparse, static per-tile resource zones independently.
 */
export const NATURAL_RESOURCES = ["fertile_soil","oil","gas","coal","gold","silver","copper","iron","lithium","uranium"] as const;
export type NaturalResource = (typeof NATURAL_RESOURCES)[number];
export type ResourceCategory = "agriculture" | "energy" | "mineral";
export const RESOURCE_CATEGORY: Readonly<Record<NaturalResource, ResourceCategory>> = {
  fertile_soil: "agriculture",
  oil: "energy",
  gas: "energy",
  coal: "energy",
  gold: "mineral",
  silver: "mineral",
  copper: "mineral",
  iron: "mineral",
  lithium: "mineral",
  uranium: "mineral",
};
/** Broad regional indicators, NOT tile locations or borders. */
export const WORLD_RESOURCE_PROFILES = {
  "United States": ["fertile_soil", "oil", "gas", "coal", "gold", "silver", "copper", "iron", "lithium", "uranium"],
  "Canada": ["fertile_soil", "oil", "gas", "coal", "gold", "silver", "copper", "iron", "uranium"],
  "Mexico": ["fertile_soil", "oil", "gas", "silver", "gold", "copper", "iron"],
  "Cuba": ["fertile_soil", "copper"],
  "Colombia": ["fertile_soil", "oil", "gas", "coal", "gold", "silver"],
  "Venezuela": ["oil", "gas", "gold", "iron"],
  "Argentina": ["fertile_soil", "oil", "gas", "lithium", "copper", "gold", "silver", "uranium"],
  "Brazil": ["fertile_soil", "oil", "gas", "iron", "gold", "copper", "uranium"],
  "Antarctica": [],
  "Greenland": ["iron", "copper", "uranium"],
  "Iceland": ["fertile_soil"],
  "United Kingdom": ["fertile_soil", "oil", "gas", "coal", "iron"],
  "Ireland": ["fertile_soil"],
  "Spain": ["fertile_soil", "copper", "iron", "coal", "gold", "silver", "uranium"],
  "Italy": ["fertile_soil", "gas"],
  "France": ["fertile_soil", "uranium", "iron"],
  "Germany": ["fertile_soil", "coal", "iron"],
  "Sweden": ["iron", "copper", "gold", "uranium"],
  "Poland": ["fertile_soil", "coal", "copper", "silver"],
  "Belarus": ["fertile_soil"],
  "Romania": ["fertile_soil", "oil", "gas", "coal", "gold", "copper"],
  "Türkiye": ["fertile_soil", "coal", "copper", "gold", "iron"],
  "Norway": ["oil", "gas", "iron", "copper"],
  "Finland": ["iron", "copper", "gold", "uranium"],
  "Ukraine": ["fertile_soil", "coal", "iron", "gas", "uranium"],
  "Russia": ["fertile_soil", "oil", "gas", "coal", "gold", "silver", "copper", "iron", "uranium"],
  "Mongolia": ["coal", "copper", "gold", "iron", "uranium"],
  "China": ["fertile_soil", "oil", "gas", "coal", "gold", "copper", "iron", "lithium", "uranium"],
  "India": ["fertile_soil", "coal", "iron", "oil", "gas", "copper", "uranium"],
  "Kazakhstan": ["oil", "gas", "coal", "copper", "iron", "gold", "uranium"],
  "Iran": ["oil", "gas", "copper", "iron", "gold"],
  "Saudi Arabia": ["oil", "gas", "gold"],
  "Australia": ["fertile_soil", "oil", "gas", "coal", "gold", "silver", "copper", "iron", "lithium", "uranium"],
  "New Zealand": ["fertile_soil", "coal", "gold"],
  "Algeria": ["oil", "gas", "iron", "gold"],
  "Libya": ["oil", "gas"],
  "Egypt": ["fertile_soil", "oil", "gas", "gold"],
  "Niger": ["uranium", "oil", "gold"],
  "Sudan": ["fertile_soil", "gold", "oil"],
  "DR Congo": ["copper", "gold", "uranium"],
  "Ethiopia": ["fertile_soil", "gold", "gas"],
  "South Africa": ["coal", "gold", "iron", "uranium"],
  "Madagascar": ["fertile_soil", "coal", "gold"],
  "Chad": ["oil", "gold", "uranium"],
  "Namibia": ["uranium", "copper", "gold"],
  "Philippines": ["fertile_soil", "copper", "gold"],
  "Thailand": ["fertile_soil", "gas"],
  "Taiwan": ["fertile_soil", "coal"],
  "Japan": ["fertile_soil", "gold", "silver"],
  "Siberia": ["oil", "gas", "coal", "gold", "iron", "uranium"],
  "Nunavut": ["iron", "gold", "uranium"],
  "West Antarctica": [],
  "Peru": ["fertile_soil", "copper", "gold", "silver", "iron"],
  "Zambia": ["copper", "gold", "coal"],
  "Latvia": ["fertile_soil"],
  "Bhutan": ["fertile_soil"],
  "Indonesia": ["fertile_soil", "oil", "gas", "coal", "gold", "copper"],
  "East Antarctica": [],
  "Oman": ["oil", "gas", "copper"],
  "Morocco": ["fertile_soil", "silver", "copper"],
  "Uruguay": ["fertile_soil"],
  "Bolivia": ["lithium", "gas", "silver", "gold", "copper"],
  "Alaska": ["oil", "gas", "gold", "copper", "coal"],
  "Yukon": ["gold", "silver", "copper"],
  "California": ["fertile_soil", "oil", "gas", "gold", "lithium"],
  "Texas": ["oil", "gas", "fertile_soil", "coal"],
  "Quebec": ["fertile_soil", "iron", "gold", "lithium"],
  "Benin": ["fertile_soil", "oil"],
  "Senegal": ["fertile_soil", "gold"],
  "Kenya": ["fertile_soil", "gold"],
  "Pakistan": ["fertile_soil", "coal", "gas", "copper", "gold"],
  "Sri Lanka": ["fertile_soil"],
} as const satisfies Readonly<Record<string, readonly NaturalResource[]>>;
export type WorldResourceRegion = keyof typeof WORLD_RESOURCE_PROFILES;
export function worldResourceProfile(region: string): readonly NaturalResource[] {
  return Object.prototype.hasOwnProperty.call(WORLD_RESOURCE_PROFILES, region)
    ? WORLD_RESOURCE_PROFILES[region as WorldResourceRegion]
    : [];
}

/** Fixed world-map reference points, from the authored map manifest.
 * These are geographic anchors, never ownership or political borders.
 */
export const WORLD_REGION_ANCHORS = {
  "United States": [
    484,
    284
  ],
  "Canada": [
    374,
    186
  ],
  "Mexico": [
    375,
    374
  ],
  "Cuba": [
    500,
    378
  ],
  "Colombia": [
    527,
    487
  ],
  "Venezuela": [
    576,
    466
  ],
  "Argentina": [
    565,
    737
  ],
  "Brazil": [
    684,
    574
  ],
  "Antarctica": [
    1280,
    975
  ],
  "Greenland": [
    709,
    57
  ],
  "Iceland": [
    831,
    112
  ],
  "United Kingdom": [
    925,
    186
  ],
  "Ireland": [
    887,
    183
  ],
  "Spain": [
    908,
    264
  ],
  "Italy": [
    1004,
    250
  ],
  "France": [
    948,
    221
  ],
  "Germany": [
    990,
    195
  ],
  "Sweden": [
    1014,
    137
  ],
  "Poland": [
    1031,
    193
  ],
  "Belarus": [
    1102,
    183
  ],
  "Romania": [
    1073,
    230
  ],
  "Türkiye": [
    1123,
    272
  ],
  "Norway": [
    969,
    133
  ],
  "Finland": [
    1082,
    126
  ],
  "Ukraine": [
    1135,
    210
  ],
  "Russia": [
    1351,
    134
  ],
  "Mongolia": [
    1500,
    203
  ],
  "China": [
    1527,
    303
  ],
  "India": [
    1331,
    353
  ],
  "Kazakhstan": [
    1279,
    207
  ],
  "Iran": [
    1238,
    309
  ],
  "Saudi Arabia": [
    1178,
    351
  ],
  "Australia": [
    1679,
    657
  ],
  "New Zealand": [
    1890,
    775
  ],
  "Algeria": [
    957,
    295
  ],
  "Libya": [
    1024,
    340
  ],
  "Egypt": [
    1094,
    340
  ],
  "Niger": [
    956,
    389
  ],
  "Sudan": [
    1101,
    400
  ],
  "DR Congo": [
    1051,
    513
  ],
  "Ethiopia": [
    1153,
    451
  ],
  "South Africa": [
    1075,
    707
  ],
  "Madagascar": [
    1194,
    627
  ],
  "Chad": [
    1036,
    420
  ],
  "Namibia": [
    1039,
    646
  ],
  "Philippines": [
    1632,
    465
  ],
  "Thailand": [
    1502,
    415
  ],
  "Taiwan": [
    1610,
    364
  ],
  "Japan": [
    1710,
    290
  ],
  "Siberia": [
    1626,
    118
  ],
  "Nunavut": [
    422,
    95
  ],
  "West Antarctica": [
    419,
    975
  ],
  "Peru": [
    516,
    567
  ],
  "Zambia": [
    1097,
    598
  ],
  "Latvia": [
    1067,
    168
  ],
  "Bhutan": [
    1419,
    338
  ],
  "Indonesia": [
    1511,
    524
  ],
  "East Antarctica": [
    1809,
    977
  ],
  "Oman": [
    1255,
    382
  ],
  "Morocco": [
    886,
    327
  ],
  "Uruguay": [
    626,
    704
  ],
  "Bolivia": [
    581,
    620
  ],
  "Alaska": [
    95,
    115
  ],
  "Yukon": [
    243,
    131
  ],
  "California": [
    264,
    276
  ],
  "Texas": [
    371,
    299
  ],
  "Quebec": [
    532,
    191
  ],
  "Benin": [
    932,
    476
  ],
  "Senegal": [
    845,
    425
  ],
  "Kenya": [
    1152,
    522
  ],
  "Pakistan": [
    1320,
    282
  ],
  "Sri Lanka": [
    1384,
    466
  ]
} as const satisfies Readonly<Record<WorldResourceRegion, readonly [number, number]>>;

export interface ResourceDeposit {
  /** A deterministic, map-local deposit ID (stable across clients/saves). */
  id: number;
  resource: NaturalResource;
  x: number;
  y: number;
  radius: number;
  quality: 1 | 2 | 3 | 4;
  /** Production cycles available. Fertile soil does not deplete. */
  capacity: number;
}

const depositCache = new WeakMap<GameMap, Map<string, readonly ResourceDeposit[]>>();

function hash32(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function candidateOnLand(map: GameMap, x: number, y: number, radius: number): [number, number] | null {
  if (map.isLand(map.ref(x,y))) return [x,y];
  // Only integer arithmetic determines map resources: cross-browser
  // floating-point trigonometry must never influence the game simulation.
  for (let r = 1; r <= Math.max(3, radius); r++) {
    for (let d = -r; d <= r; d++) {
      const candidates: readonly (readonly [number, number])[] = [
        [x + d, y - r], [x + d, y + r],
        [x - r, y + d], [x + r, y + d],
      ];
      for (const [cx, cy] of candidates) {
        const xx = clampInt(cx, 0, map.width() - 1);
        const yy = clampInt(cy, 0, map.height() - 1);
        if (map.isLand(map.ref(xx, yy))) return [xx, yy];
      }
    }
  }
  return null;
}
/** Same deterministic distribution on the engine worker and the client.
 * The World map is authored country/region by country/region. Other maps
 * use seeded regional clusters rather than a random value for every tile.
 */
export function resourceDeposits(map: GameMap, mapType: string): readonly ResourceDeposit[] {
  let byMap = depositCache.get(map);
  if (!byMap) {
    byMap = new Map();
    depositCache.set(map, byMap);
  }
  const cached = byMap.get(mapType);
  if (cached) return cached;
  const sites: ResourceDeposit[] = [];
  // Check every resource type: two different deposits must not hide each
  // other either. Keep a small clear strip between their actual map circles.
  const gap = Math.max(1, Math.round(Math.min(map.width() / 2000, map.height() / 1000) * 3));
  const fits = (x: number, y: number, radius: number): boolean => {
    if (x < 0 || y < 0 || x >= map.width() || y >= map.height()) return false;
    if (!map.isLand(map.ref(x, y))) return false;
    return sites.every((site) => {
      const dx = x - site.x, dy = y - site.y;
      const separation = radius + site.radius + gap;
      return dx * dx + dy * dy >= separation * separation;
    });
  };
  const add = (resource: NaturalResource, tx: number, ty: number, radius: number, seed: number): void => {
    const x = clampInt(tx, 0, map.width()-1);
    const y = clampInt(ty, 0, map.height()-1);
    let land = candidateOnLand(map, x, y, radius);
    if (!land || !fits(land[0], land[1], radius)) {
      land = null;
      // Bounded integer-only search preserves regional geography and identical
      // engine/client results. In a crowded island omit a site rather than
      // stacking it or moving it across the world to unrelated terrain.
      const reach = mapType === "World"
        ? Math.max(radius * 3, Math.round(Math.min(map.width() / 2000, map.height() / 1000) * 70))
        : radius * 3;
      const step = Math.max(1, Math.floor(radius / 2));
      const tryPoint = (dx: number, dy: number): boolean => {
        if (!fits(x + dx, y + dy, radius)) return false;
        land = [x + dx, y + dy];
        return true;
      };
      for (let r = step; r <= reach && land === null; r += step) {
        for (let d = -r; d <= r && land === null; d += step) {
          // Seeded orientation avoids always displacing sites north-west.
          const sign = seed % 2 === 0 ? 1 : -1;
          if (tryPoint(d * sign, -r * sign) || tryPoint(r * sign, d * sign) ||
              tryPoint(-d * sign, r * sign) || tryPoint(-r * sign, -d * sign)) break;
        }
      }
    }
    if (!land) return;
    sites.push({
      id: sites.length,
      resource,
      x: land[0],
      y: land[1],
      radius,
      quality: ((seed % 4) + 1) as 1 | 2 | 3 | 4,
      capacity: resource === "fertile_soil" ? Number.MAX_SAFE_INTEGER : 240 + (seed % 4) * 140,
    });
  };
  if (mapType === "World") {
    const sx = map.width() / 2000;
    const sy = map.height() / 1000;
    for (const [region, resources] of Object.entries(WORLD_RESOURCE_PROFILES)) {
      const anchor = WORLD_REGION_ANCHORS[region as WorldResourceRegion];
      const [ax, ay] = anchor;
      for (const resource of resources) {
        const count = resource === "fertile_soil" ? 3 : resource === "oil" || resource === "gas" ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const seed = hash32(region + "|" + resource + "|" + i);
          const spread = i === 0 ? 16 : 34;
          const dx = ((seed >>> 8) % (spread * 2 + 1)) - spread;
          const dy = ((seed >>> 16) % (spread * 2 + 1)) - spread;
          const radius = Math.max(3, Math.round(
            (resource === "fertile_soil" ? 19 : resource === "oil" || resource === "gas" ? 13 : 10) * sx
          ));
          add(resource, (ax + dx) * sx,
            (ay + dy) * sy, radius, seed);
        }
      }
    }
  } else {
    const cols = Math.max(5, Math.min(20, Math.ceil(map.width() / 90)));
    const rows = Math.max(5, Math.min(20, Math.ceil(map.height() / 90)));
    const stepX = map.width() / cols;
    const stepY = map.height() / rows;
    const genericTypes: readonly NaturalResource[] = NATURAL_RESOURCES;
    for (let row=0; row<rows; row++) {
      for (let col=0; col<cols; col++) {
        const seed=hash32(mapType+"|"+col+"|"+row);
        // Intentionally leave most terrain without exploitable resources.
        if (seed%100 < 45) continue;
        const res=genericTypes[(seed >>> 8) % genericTypes.length];
        const radius=Math.max(2, Math.round(Math.min(stepX,stepY) * (res==="fertile_soil"?0.42:0.28)));
        const px=(col+0.25+((seed>>>16)%50)/100)*stepX;
        const py=(row+0.25+((seed>>>24)%50)/100)*stepY;
        add(res,px,py,radius,seed);
      }
    }
  }
  byMap.set(mapType, sites);
  return sites;
}
/** Resolve the actual deposit footprint shared by rendering and extraction. */
export function resourceAt(map: GameMap, mapType: string, tile: number): ResourceDeposit | null {
  if (!map.isValidRef(tile) || !map.isLand(tile)) return null;
  const x=map.x(tile), y=map.y(tile);
  const sites=resourceDeposits(map,mapType);
  for(let i=sites.length-1; i>=0; i--) {
    const site=sites[i];
    const dx=x-site.x, dy=y-site.y;
    if (dx*dx+dy*dy<=site.radius*site.radius) return site;
  }
  return null;
}

