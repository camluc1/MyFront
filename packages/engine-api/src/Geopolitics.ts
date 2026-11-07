import { zb } from "@openfront/zbin";
import { z } from "zod";

export const TreatyKindSchema = z.enum([
  "truce",
  "nonaggression",
  "coalition",
  "peace",
]);
export type TreatyKind = z.infer<typeof TreatyKindSchema>;
export const DiplomaticAssetsSchema = z.object({
  gold: zb.uint({ max: 1000000000000 }),
  troops: zb.uint({ max: 1000000000000 }),
  tiles: z.array(zb.uint()).max(20000),
  buildings: z.array(zb.uint()).max(500),
});
export type DiplomaticAssets = z.infer<typeof DiplomaticAssetsSchema>;
export const DiplomacyActionSchema = z.object({
  action: z.enum(["offer", "accept", "reject", "withdraw", "break", "leave"]),
  target: z.string().max(100),
  offerID: zb.uint().optional(),
  kind: TreatyKindSchema.optional(),
  give: DiplomaticAssetsSchema.optional(),
  receive: DiplomaticAssetsSchema.optional(),
  threat: z.string().max(100).optional(),
  counterTo: zb.uint().optional(),
  ultimatum: z.boolean().optional(),
});
export type DiplomacyAction = z.infer<typeof DiplomacyActionSchema>;
export const DiplomaticOfferSchema = z.object({
  id: z.number(),
  from: z.string(),
  to: z.string(),
  kind: TreatyKindSchema,
  give: DiplomaticAssetsSchema,
  receive: DiplomaticAssetsSchema,
  created: z.number(),
  expires: z.number(),
  threat: z.string(),
  status: z.enum([
    "pending",
    "accepted",
    "rejected",
    "withdrawn",
    "expired",
    "invalid",
    "countered",
  ]),
  reason: z.string(),
  ultimatum: z.boolean().optional(),
  enforced: z.boolean().optional(),
  approvals: z.array(z.string()),
  required: z.array(z.string()),
});
export type DiplomaticOffer = z.infer<typeof DiplomaticOfferSchema>;
export const DiplomacyStateSchema = z.object({
  nextID: z.number(),
  offers: z.array(DiplomaticOfferSchema),
  treaties: z.array(
    z.object({
      id: z.number(),
      a: z.string(),
      b: z.string(),
      kind: TreatyKindSchema,
      until: z.number(),
    }),
  ),
  coalitions: z.array(
    z.object({
      id: z.number(),
      members: z.array(z.string()),
      threat: z.string(),
      until: z.number(),
    }),
  ),
  memory: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      trust: z.number(),
      betrayal: z.number(),
      aid: z.number(),
      kept: z.number(),
      tick: z.number(),
    }),
  ),
  cooldowns: z.record(z.string(), z.number()),
  victory: z
    .object({
      members: z.array(z.string()),
      since: z.number(),
      remaining: z.number(),
      share: z.number(),
    })
    .nullable(),
  winner: z.array(z.string()),
  log: z.array(
    z.object({
      tick: z.number(),
      actor: z.string(),
      target: z.string(),
      event: z.string(),
    }),
  ),
});
export type DiplomacyState = z.infer<typeof DiplomacyStateSchema>;
export const emptyAssets = (): DiplomaticAssets => ({
  gold: 0,
  troops: 0,
  tiles: [],
  buildings: [],
});
export const emptyDiplomacy = (): DiplomacyState => ({
  nextID: 1,
  offers: [],
  treaties: [],
  coalitions: [],
  memory: [],
  cooldowns: {},
  victory: null,
  winner: [],
  log: [],
});
export const TREATY_TICKS: Record<TreatyKind, number> = {
  truce: 600,
  nonaggression: 1800,
  peace: 1800,
  coalition: 3000,
};
