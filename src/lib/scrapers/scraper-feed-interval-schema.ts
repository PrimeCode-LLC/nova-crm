import { z } from "zod";

export const scraperRunIntervalUnitSchema = z.enum(["minutes", "hours", "days"]);

/** Optional interval fields for create/patch scraper feed APIs. */
export const scraperFeedIntervalSchema = z.object({
  runIntervalMinutes: z.number().int().min(15).max(30 * 24 * 60).optional(),
  runIntervalValue: z.number().int().positive().optional(),
  runIntervalUnit: scraperRunIntervalUnitSchema.optional(),
});

export type ScraperFeedIntervalInput = z.infer<typeof scraperFeedIntervalSchema>;
