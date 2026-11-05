import { z } from "zod";
export const INCOME_RATE_WINDOW_TICKS = 1200;
// Compact rows: id, tiles, reserves, deployed, bank, received, recurring, buildings, levels, farm, mine, oil, gas.
export const HistoryRowSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export const MatchHistorySchema = z.object({
  version: z.literal(1),
  startTick: z.number(),
  endTick: z.number().optional(),
  players: z.array(
    z.object({ id: z.number(), name: z.string(), kind: z.string() }),
  ),
  samples: z.array(
    z.object({
      tick: z.number(),
      rows: z.array(HistoryRowSchema),
      sources: z.record(z.string(), z.array(z.number())).optional(),
    }),
  ),
  eliminations: z
    .array(
      z.object({
        id: z.number(),
        tick: z.number(),
        killer: z.number().nullable(),
      }),
    )
    .optional(),
});
export type MatchHistory = z.infer<typeof MatchHistorySchema>;
export type HistoryRow = z.infer<typeof HistoryRowSchema>;
