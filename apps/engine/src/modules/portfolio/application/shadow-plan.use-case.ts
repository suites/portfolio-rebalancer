import { createHash } from "node:crypto";

import type {
  AccountId,
  BrokerId,
  BrokerObservationMetadata,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import type { TossAccount } from "@portfolio-rebalancer/broker-toss";
import {
  COMMISSION_ESTIMATE_POLICY_VERSION,
  SHADOW_PLAN_CANONICAL_VERSION,
  classifyMarketCalendarReadiness,
  createBlockedShadowRebalancePlan,
  createShadowRebalancePlan,
  estimateCommission,
  evaluateQuoteFreshness,
  type CreateShadowPlanInput,
  type ShadowPlanResult,
} from "@portfolio-rebalancer/application";
import type { Prisma } from "@portfolio-rebalancer/database";
import type { DecimalString } from "@portfolio-rebalancer/domain";

import type { EngineConfig } from "../../../config/engine.config";
import { RebalancePlanError } from "../domain/rebalance-plan.error";
import { normalizeTossInstrumentValidation, selectExactStock } from "./instrument-catalog";
import type { TossReadSource } from "../infrastructure/broker/toss-read-source.adapter";
import type { TossRequestAuditContext } from "../infrastructure/broker/toss-request-audit.context";
import type {
  PrismaPortfolioRepository,
  SealShadowRebalancePlanInput,
} from "../infrastructure/persistence/prisma-portfolio.repository";

const PLAN_MINIMUM_ORDER_MINOR = 10_000n;
const PLAN_FEE_BUFFER_MINOR = 5_000n;
const PLAN_QUOTE_MAX_AGE_MS = 300_000;
const PLAN_CALENDAR_MAX_AGE_MS = 172_800_000;
const PLAN_FUTURE_TOLERANCE_MS = 60_000;

type PlanningSnapshot = NonNullable<
  Awaited<ReturnType<PrismaPortfolioRepository["latestDashboardState"]>>["snapshot"]
>;
type StoredRebalanceRun = NonNullable<
  Awaited<ReturnType<PrismaPortfolioRepository["rebalanceRunById"]>>
>;

export interface CreateShadowPlanOptions {
  readonly repository: PrismaPortfolioRepository;
  readonly source: TossReadSource;
  readonly requestAuditContext: TossRequestAuditContext;
  readonly selectedAccountSeq: EngineConfig["TOSSINVEST_ACCOUNT_SEQ"];
  readonly now?: () => Date;
}

export async function createAndStoreShadowPlan(
  options: CreateShadowPlanOptions,
): Promise<StoredRebalanceRun> {
  const clock = options.now ?? (() => new Date());
  const startedAt = readClock(clock, "Shadow 계획 시작시각");
  const state = await options.repository.latestDashboardState();
  const snapshot = requirePlanningSnapshot(state.snapshot, state.activeTargetVersionId);
  const target = snapshot.targetConfigVersion;
  if (!target) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_MISSING",
      "최신 스냅샷에 고정된 목표 설정이 없습니다.",
      false,
    );
  }
  const baseInput = buildPlanInput(snapshot, {
    pinnedSnapshotId: snapshot.id,
    currentSnapshotId: snapshot.id,
    pinnedSnapshotDigest: snapshot.digest,
    currentSnapshotDigest: snapshot.digest,
    pinnedConfigVersionId: target.id,
    currentConfigVersionId: target.id,
  });
  const dedupeKey = createPlanDedupeKey({
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.digest,
    targetConfigVersionId: target.id,
    targetConfigContentHash: target.contentHash,
    baseInput,
  });
  const started = await options.repository.startShadowRebalanceRun({
    accountId: snapshot.accountId,
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.digest,
    targetConfigVersionId: target.id,
    targetConfigContentHash: target.contentHash,
    dedupeKey,
    startedAt,
    policyVersion: SHADOW_PLAN_CANONICAL_VERSION,
  });
  if (!started) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_STALE",
      "계획 시작 전에 최신 스냅샷 또는 활성 목표 설정이 변경되었습니다.",
      true,
    );
  }
  if (!started.created) {
    return requireExistingRun(await options.repository.rebalanceRunById(started.runId));
  }

  try {
    const result = await options.requestAuditContext.run(
      { workflowType: "SHADOW_PLAN", correlationId: started.runId },
      () =>
        calculatePlanWithPreflight({
          ...options,
          clock,
          snapshot,
          baseInput,
        }),
    );
    const sealed = await sealResult(
      options.repository,
      started.runId,
      snapshot,
      result,
      readClock(clock, "Shadow 계획 완료시각"),
      true,
    );
    if (sealed) return sealed;

    const current = await options.repository.currentRebalanceIdentity(snapshot.accountId);
    const staleInput: CreateShadowPlanInput = {
      ...baseInput,
      identity: {
        ...baseInput.identity,
        currentSnapshotId: current.snapshotId,
        currentSnapshotDigest: current.snapshotDigest,
        currentConfigVersionId:
          current.snapshotTargetConfigVersionId === current.targetConfigVersionId
            ? current.targetConfigVersionId
            : null,
      },
    };
    const staleResult = createShadowRebalancePlan(staleInput);
    const staleSealed = await sealResult(
      options.repository,
      started.runId,
      snapshot,
      staleResult,
      readClock(clock, "Shadow 계획 차단 완료시각"),
      false,
    );
    if (!staleSealed) {
      throw new RebalancePlanError(
        "PLAN_PERSIST_FAILED",
        "변경된 snapshot을 감지했지만 차단 계획을 안전하게 저장하지 못했습니다.",
        true,
      );
    }
    return staleSealed;
  } catch (error) {
    const completedAt = failureCompletedAt(clock, startedAt);
    await options.repository.failShadowRebalanceRun(
      started.runId,
      error instanceof RebalancePlanError ? error.code : "PLAN_UNEXPECTED_FAILURE",
      completedAt,
    );
    if (error instanceof RebalancePlanError) throw error;
    throw new RebalancePlanError(
      "PLAN_BROKER_PREFLIGHT_FAILED",
      "Shadow 계획의 조회 증거를 안전하게 확인하지 못했습니다.",
      true,
      { cause: error },
    );
  }
}

async function calculatePlanWithPreflight(input: {
  readonly repository: PrismaPortfolioRepository;
  readonly source: TossReadSource;
  readonly selectedAccountSeq: number | undefined;
  readonly clock: () => Date;
  readonly snapshot: PlanningSnapshot;
  readonly baseInput: CreateShadowPlanInput;
}): Promise<ShadowPlanResult> {
  const unsupported = createShadowRebalancePlan(input.baseInput);
  if (
    unsupported.status === "BLOCKED" &&
    unsupported.reasonCodes.some((code) =>
      ["UNSUPPORTED_MARKET", "UNSUPPORTED_CURRENCY", "INSTRUMENT_INPUT_INVALID"].includes(code),
    )
  ) {
    return unsupported;
  }

  const quoteBlock = quoteFreshnessBlock(
    input.snapshot,
    input.baseInput,
    readClock(input.clock, "시세 점검시각"),
  );
  if (quoteBlock) {
    return createBlockedShadowRebalancePlan(input.baseInput, quoteBlock);
  }

  const preliminaryInput = withSellableQuantities(
    input.baseInput,
    new Map(
      input.baseInput.assetClasses.flatMap((asset) =>
        asset.instruments.map((instrument) => [
          `${instrument.marketCountry}:${instrument.symbol}`,
          instrument.currentQuantity,
        ]),
      ),
    ),
  );
  const preliminary = createShadowRebalancePlan(preliminaryInput);
  if (preliminary.status !== "PLANNED") return preliminary;

  const identityBeforeReads = await currentInputIdentity(
    input.repository,
    input.snapshot.accountId,
    input.baseInput,
  );
  const identityCheck = createShadowRebalancePlan(identityBeforeReads);
  if (
    identityCheck.reasonCodes.some(
      (reasonCode) => reasonCode === "IDENTITY_MISSING" || reasonCode === "IDENTITY_MISMATCH",
    )
  ) {
    return identityCheck;
  }

  let account: TossAccount;
  try {
    account = selectReadAccount(await input.source.listAccounts(), input.selectedAccountSeq);
  } catch {
    return createBlockedShadowRebalancePlan(identityBeforeReads, "TRADE_RESTRICTION_UNVERIFIED");
  }
  const accountReference = {
    accountSeq: account.accountSeq,
    accountId: input.snapshot.accountId as AccountId,
  };
  const touchedInstruments = uniqueTouchedInstruments(preliminary);

  try {
    const stocks = await input.source.getStocks(touchedInstruments.map(({ symbol }) => symbol));
    for (const instrument of touchedInstruments) {
      const exact = { requestedMarketCountry: instrument.marketCountry, symbol: instrument.symbol };
      const stock = selectExactStock(stocks.result, exact);
      const warnings = await input.source.getStockWarnings(instrument.symbol);
      const validation = normalizeTossInstrumentValidation({
        request: exact,
        stock,
        warnings: warnings.result,
        observedAt: readClock(input.clock, `${instrument.symbol} 거래 제한 점검시각`),
      });
      const stored = await input.repository.recordInstrumentValidation(validation);
      if (stored.targetEligibility !== "ELIGIBLE" || stored.tradeBlockedNow) {
        return createBlockedShadowRebalancePlan(
          identityBeforeReads,
          "TRADE_RESTRICTION_UNVERIFIED",
        );
      }
    }
  } catch {
    return createBlockedShadowRebalancePlan(identityBeforeReads, "TRADE_RESTRICTION_UNVERIFIED");
  }

  const sellableByInstrument = new Map<string, bigint>();
  try {
    for (const order of preliminary.executableOrders.filter(({ side }) => side === "SELL")) {
      const sellable = await input.source.getSellableQuantity(accountReference, {
        marketCountry: order.marketCountry,
        symbol: order.symbol as SymbolCode,
      });
      sellableByInstrument.set(
        order.instrumentKey,
        parseWholeUnits(sellable.value.quantity, "매도 가능 수량"),
      );
    }
  } catch {
    sellableByInstrument.clear();
  }

  const currentInput = await currentInputIdentity(
    input.repository,
    input.snapshot.accountId,
    withSellableQuantities(identityBeforeReads, sellableByInstrument),
  );
  const result = createShadowRebalancePlan(currentInput);
  if (result.status !== "PLANNED") return result;

  const calendarBlock = calendarReadinessBlock(
    input.snapshot,
    readClock(input.clock, "시장 캘린더 점검시각"),
  );
  if (calendarBlock) {
    return createBlockedShadowRebalancePlan(currentInput, calendarBlock);
  }

  try {
    const schedule = await input.source.getCommissionSchedule(accountReference, ["KR"]);
    const tradeDate = dateInSeoul(readClock(input.clock, "수수료 거래일 점검시각")) as IsoDate;
    const totalCommissionMinor = result.executableOrders.reduce(
      (sum, order) =>
        sum +
        estimateCommission({
          schedule: schedule.value,
          marketCountry: order.marketCountry,
          tradeDate,
          notionalMinor: order.notionalMinor,
        }).commissionMinor,
      0n,
    );
    if (
      totalCommissionMinor > PLAN_FEE_BUFFER_MINOR ||
      COMMISSION_ESTIMATE_POLICY_VERSION !== "COMMISSION_CEIL_V1"
    ) {
      return createBlockedShadowRebalancePlan(currentInput, "COMMISSION_UNVERIFIED");
    }
  } catch {
    return createBlockedShadowRebalancePlan(currentInput, "COMMISSION_UNVERIFIED");
  }

  return result;
}

function requirePlanningSnapshot(
  snapshot: PlanningSnapshot | null,
  activeTargetVersionId: string | null,
): PlanningSnapshot {
  if (!snapshot) {
    throw new RebalancePlanError("NO_SNAPSHOT", "계획에 사용할 계좌 스냅샷이 없습니다.", false);
  }
  if (snapshot.validationStatus !== "VERIFIED") {
    throw new RebalancePlanError(
      "SNAPSHOT_UNVERIFIED",
      "최신 계좌 스냅샷의 검증 상태가 VERIFIED가 아닙니다.",
      true,
    );
  }
  if (!snapshot.targetConfigVersion) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_MISSING",
      "최신 스냅샷에 목표 설정이 고정되지 않았습니다.",
      false,
    );
  }
  if (snapshot.targetConfigVersion.id !== activeTargetVersionId) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_STALE",
      "활성 목표 설정이 최신 스냅샷에 아직 반영되지 않았습니다.",
      true,
    );
  }
  if (snapshot.managedCashMinor === null) {
    throw new RebalancePlanError(
      "MANAGED_CASH_MISSING",
      "평가에 사용할 관리 현금 기준이 최신 스냅샷에 없습니다.",
      false,
    );
  }
  return snapshot;
}

function buildPlanInput(
  snapshot: PlanningSnapshot,
  identity: CreateShadowPlanInput["identity"],
): CreateShadowPlanInput {
  const target = snapshot.targetConfigVersion;
  if (!target) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_MISSING",
      "최신 스냅샷에 목표 설정이 고정되지 않았습니다.",
      false,
    );
  }
  const holdings = new Map(
    snapshot.holdings.map((holding) => [`${holding.marketCountry}:${holding.symbol}`, holding]),
  );
  const managedKeys = new Set(
    target.allocations.flatMap((allocation) =>
      allocation.instruments.map(
        (instrument) => `${instrument.marketCountry}:${instrument.symbol}`,
      ),
    ),
  );
  if (
    snapshot.holdings.some(
      (holding) => !managedKeys.has(`${holding.marketCountry}:${holding.symbol}`),
    )
  ) {
    throw new RebalancePlanError(
      "TARGET_CONFIG_STALE",
      "목표 설정에 포함되지 않은 보유종목이 있어 계획을 만들 수 없습니다.",
      false,
    );
  }
  const prices = new Map(
    snapshot.prices.map((price) => [`${price.marketCountry}:${price.symbol}`, price]),
  );
  const assetClasses = target.allocations.map((allocation) => {
    if (allocation.assetKey === "CASH") {
      return {
        id: allocation.assetKey,
        kind: "CASH" as const,
        currentValueMinor: snapshot.managedCashMinor ?? 0n,
        targetBasisPoints: BigInt(allocation.targetBasisPoints),
        lowerBasisPoints: BigInt(allocation.lowerBasisPoints),
        upperBasisPoints: BigInt(allocation.upperBasisPoints),
        instruments: [],
      };
    }
    const instruments = allocation.instruments.map((instrument) => {
      const key = `${instrument.marketCountry}:${instrument.symbol}`;
      const holding = holdings.get(key);
      const price = prices.get(key);
      return {
        marketCountry: instrument.marketCountry,
        currency: instrument.currency,
        symbol: instrument.symbol,
        currentValueMinor: holding?.marketValueKrwMinor ?? 0n,
        targetWithinAssetPoints: BigInt(instrument.withinAssetPoints),
        currentQuantity: parseWholeUnits(holding?.quantity ?? "0", `${key} 보유 수량`),
        priceMinor:
          instrument.marketCountry === "KR" && instrument.currency === "KRW"
            ? parseKrwMinor(price?.lastPrice ?? null)
            : null,
        availableSellQuantity: null,
      };
    });
    return {
      id: allocation.assetKey,
      kind: "SECURITIES" as const,
      currentValueMinor: instruments.reduce(
        (sum, instrument) => sum + instrument.currentValueMinor,
        0n,
      ),
      targetBasisPoints: BigInt(allocation.targetBasisPoints),
      lowerBasisPoints: BigInt(allocation.lowerBasisPoints),
      upperBasisPoints: BigInt(allocation.upperBasisPoints),
      instruments,
    };
  });
  const cashTarget = assetClasses.find(({ id }) => id === "CASH");
  const managedCashMinor = snapshot.managedCashMinor;
  const cashTargetMinor =
    cashTarget && snapshot.totalValueMinor > 0n
      ? ceilDiv(snapshot.totalValueMinor * cashTarget.targetBasisPoints, 10_000n)
      : 0n;
  const spendableCashMinor = maxBigInt(
    0n,
    (managedCashMinor ?? 0n) - cashTargetMinor - PLAN_FEE_BUFFER_MINOR,
  );
  return {
    identity,
    assetClasses,
    managedCashMinor,
    spendableCashMinor,
    returnPolicy: "BAND_EDGE",
    minimumOrderMinor: PLAN_MINIMUM_ORDER_MINOR,
    orderPrerequisites: {
      orderType: "LIMIT",
      timeInForce: "DAY",
      wholeSharesOnly: true,
    },
  };
}

function quoteFreshnessBlock(
  snapshot: PlanningSnapshot,
  planInput: CreateShadowPlanInput,
  now: Date,
): "QUOTE_STALE" | null {
  const prices = new Map(
    snapshot.prices.map((price) => [`${price.marketCountry}:${price.symbol}`, price]),
  );
  for (const instrument of planInput.assetClasses.flatMap((asset) => asset.instruments)) {
    if (instrument.marketCountry !== "KR") continue;
    const price = prices.get(`${instrument.marketCountry}:${instrument.symbol}`);
    if (!price) return "QUOTE_STALE";
    const decision = evaluateQuoteFreshness({
      quote: {
        marketCountry: "KR",
        symbol: instrument.symbol as SymbolCode,
        price: price.lastPrice as DecimalString,
        currency: "KRW",
        observedAt: price.providerObservedAt?.toISOString() as IsoDateTime | null,
      },
      metadata: brokerMetadata("getPrices", price.receivedAt),
      policy: {
        now,
        maxAgeMs: PLAN_QUOTE_MAX_AGE_MS,
        futureToleranceMs: PLAN_FUTURE_TOLERANCE_MS,
      },
    });
    if (!decision.canProceed) return "QUOTE_STALE";
  }
  return null;
}

function calendarReadinessBlock(
  snapshot: PlanningSnapshot,
  now: Date,
): "MARKET_CALENDAR_STALE" | "MARKET_SESSION_UNVERIFIED" | null {
  const stored = snapshot.marketCalendars.find(({ marketCountry }) => marketCountry === "KR");
  if (!stored) return "MARKET_CALENDAR_STALE";
  const decision = classifyMarketCalendarReadiness({
    calendar: stored.calendar as unknown as MarketCalendar,
    metadata: brokerMetadata("getKrMarketCalendar", stored.receivedAt),
    allowedSessionKinds: ["REGULAR_MARKET"],
    policy: {
      now,
      maxAgeMs: PLAN_CALENDAR_MAX_AGE_MS,
      futureToleranceMs: PLAN_FUTURE_TOLERANCE_MS,
    },
  });
  if (decision.reasonCode === "CALENDAR_STALE") return "MARKET_CALENDAR_STALE";
  return decision.canProceed ? null : "MARKET_SESSION_UNVERIFIED";
}

function brokerMetadata(operationId: string, receivedAt: Date): BrokerObservationMetadata {
  return {
    brokerId: "toss" as BrokerId,
    operationId,
    requestId: null,
    httpStatus: 200,
    rateLimitGroup: null,
    receivedAt: receivedAt.toISOString() as IsoDateTime,
  };
}

function withSellableQuantities(
  input: CreateShadowPlanInput,
  sellableByInstrument: ReadonlyMap<string, bigint>,
): CreateShadowPlanInput {
  return {
    ...input,
    assetClasses: input.assetClasses.map((asset) => ({
      ...asset,
      instruments: asset.instruments.map((instrument) => ({
        ...instrument,
        availableSellQuantity:
          sellableByInstrument.get(`${instrument.marketCountry}:${instrument.symbol}`) ?? null,
      })),
    })),
  };
}

async function currentInputIdentity(
  repository: PrismaPortfolioRepository,
  accountId: string,
  input: CreateShadowPlanInput,
): Promise<CreateShadowPlanInput> {
  const current = await repository.currentRebalanceIdentity(accountId);
  return {
    ...input,
    identity: {
      ...input.identity,
      currentSnapshotId: current.snapshotId,
      currentSnapshotDigest: current.snapshotDigest,
      currentConfigVersionId:
        current.snapshotTargetConfigVersionId === current.targetConfigVersionId
          ? current.targetConfigVersionId
          : null,
    },
  };
}

function uniqueTouchedInstruments(result: ShadowPlanResult) {
  const seen = new Set<string>();
  return result.executableOrders.flatMap((order) => {
    if (seen.has(order.instrumentKey)) return [];
    seen.add(order.instrumentKey);
    return [
      {
        marketCountry: order.marketCountry,
        symbol: order.symbol,
      },
    ];
  });
}

function selectReadAccount(
  accounts: readonly TossAccount[],
  selectedAccountSeq: number | undefined,
): TossAccount {
  if (selectedAccountSeq !== undefined) {
    const selected = accounts.find(({ accountSeq }) => accountSeq === selectedAccountSeq);
    if (selected) return selected;
    throw new Error("설정한 토스 계좌 순번을 찾지 못했습니다.");
  }
  if (accounts.length !== 1) {
    throw new Error("계획 전 사전조회에 사용할 토스 계좌를 하나로 확정하지 못했습니다.");
  }
  return accounts[0]!;
}

async function sealResult(
  repository: PrismaPortfolioRepository,
  runId: string,
  snapshot: PlanningSnapshot,
  result: ShadowPlanResult,
  completedAt: Date,
  requireCurrentIdentity: boolean,
): Promise<StoredRebalanceRun | null> {
  const target = snapshot.targetConfigVersion;
  if (!target || !result.snapshotId || !result.configVersionId) return null;
  const phaseOrdinals = new Map<"SELL" | "BUY", number>();
  const orders = result.executableOrders.map((order) => {
    const ordinal = phaseOrdinals.get(order.phase) ?? 0;
    phaseOrdinals.set(order.phase, ordinal + 1);
    return { ...order, ordinal };
  });
  const storage: SealShadowRebalancePlanInput = {
    runId,
    accountId: snapshot.accountId,
    snapshotId: result.snapshotId,
    targetConfigVersionId: result.configVersionId,
    status: result.status,
    canonicalVersion: result.canonicalVersion,
    planHash: result.planHash,
    returnPolicy: result.returnPolicy,
    totalValueMinor: result.totalValueMinor,
    reasonCodes: result.reasonCodes,
    canonicalContent: result.canonicalContent,
    assetDecisions: jsonValue(result.assetDecisions),
    deferredBuyNeeds: jsonValue(result.deferredBuyNeeds),
    projectedAllocations: jsonValue(result.projectedAllocations),
    orders,
    completedAt,
    requireCurrentIdentity,
  };
  return repository.sealShadowRebalancePlan(storage);
}

function createPlanDedupeKey(input: {
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly targetConfigVersionId: string;
  readonly targetConfigContentHash: string;
  readonly baseInput: CreateShadowPlanInput;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: "SHADOW_RUN_DEDUPE_V1",
        snapshotId: input.snapshotId,
        snapshotDigest: input.snapshotDigest,
        targetConfigVersionId: input.targetConfigVersionId,
        targetConfigContentHash: input.targetConfigContentHash,
        returnPolicy: input.baseInput.returnPolicy,
        minimumOrderMinor: input.baseInput.minimumOrderMinor.toString(),
        feeBufferMinor: PLAN_FEE_BUFFER_MINOR.toString(),
        quoteMaxAgeMs: PLAN_QUOTE_MAX_AGE_MS,
        calendarMaxAgeMs: PLAN_CALENDAR_MAX_AGE_MS,
      }),
    )
    .digest("hex");
}

function requireExistingRun(run: StoredRebalanceRun | null): StoredRebalanceRun {
  if (!run) {
    throw new RebalancePlanError(
      "PLAN_PERSIST_FAILED",
      "중복 방지 키에 연결된 Shadow 실행을 찾지 못했습니다.",
      true,
    );
  }
  if (run.plan) return run;
  if (run.status === "RUNNING") {
    throw new RebalancePlanError(
      "PLAN_IN_PROGRESS",
      "같은 snapshot의 Shadow 계획 생성이 이미 진행 중입니다.",
      true,
    );
  }
  throw new RebalancePlanError(
    "PLAN_PREVIOUSLY_FAILED",
    "같은 snapshot의 이전 Shadow 계획 생성이 실패했습니다. 새 snapshot을 수집하세요.",
    true,
  );
}

function parseWholeUnits(value: string, subject: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) {
    throw new RebalancePlanError(
      "PLAN_BROKER_PREFLIGHT_FAILED",
      `${subject}을 정수 수량으로 확인하지 못했습니다.`,
      false,
    );
  }
  return BigInt(value.split(".")[0]!);
}

function parseKrwMinor(value: string | null): bigint | null {
  if (value === null || !/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) return null;
  return BigInt(value.split(".")[0]!);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key: string, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}

function readClock(clock: () => Date, subject: string): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RebalancePlanError(
      "PLAN_PERSIST_FAILED",
      `${subject}을 유효한 시각으로 확인하지 못했습니다.`,
      false,
    );
  }
  return new Date(value.getTime());
}

function failureCompletedAt(clock: () => Date, startedAt: Date): Date {
  try {
    const failedAt = readClock(clock, "Shadow 계획 실패시각");
    return failedAt.getTime() < startedAt.getTime() ? new Date(startedAt) : failedAt;
  } catch {
    return new Date(startedAt);
  }
}

function dateInSeoul(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
