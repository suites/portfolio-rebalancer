import { z } from "zod";

export const InstrumentSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(100),
});

export const InstrumentValidationInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(
      /^(?:(?:KR|US):)?[A-Za-z0-9.-]+$/i,
      "국내 종목코드, 미국 티커 또는 KR:/US: 접두 형식이어야 합니다.",
    ),
});

export const InstrumentCandidateSchema = z.object({
  validationId: z.uuid(),
  instrumentKey: z.string().regex(/^(?:KR|US):[^:]+$/),
  symbol: z.string().min(1),
  name: z.string().min(1),
  englishName: z.string().min(1).nullable(),
  marketCountry: z.enum(["KR", "US"]),
  listingMarket: z.string().min(1),
  currency: z.enum(["KRW", "USD"]),
  securityType: z.string().min(1),
  listingStatus: z.string().min(1),
  source: z.enum(["CATALOG", "TOSS_EXACT"]),
  targetEligibility: z.enum(["ELIGIBLE", "BLOCKED"]),
  targetReasonCodes: z.array(z.string().min(1)).max(20),
  addEligible: z.boolean(),
  blockedReason: z.string().min(1).nullable(),
  tradeBlockedNow: z.boolean(),
  tradeReasonCodes: z.array(z.string().min(1)).max(20),
  tradeBlockedReason: z.string().min(1).nullable(),
  requiresOrderRevalidation: z.boolean(),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const InstrumentCatalogSearchResultSchema = z.object({
  query: z.string().min(1),
  catalogScope: z.literal("LOCAL_VALIDATED"),
  candidates: z.array(InstrumentCandidateSchema).max(20),
});

export const InstrumentValidationResultSchema = z.object({
  candidate: InstrumentCandidateSchema,
});

export type InstrumentCandidateContract = z.infer<typeof InstrumentCandidateSchema>;
export type InstrumentCatalogSearchResultContract = z.infer<
  typeof InstrumentCatalogSearchResultSchema
>;
export type InstrumentValidationResultContract = z.infer<typeof InstrumentValidationResultSchema>;
