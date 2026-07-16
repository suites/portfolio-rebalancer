import type { DashboardBlockReasonContract } from "@portfolio-rebalancer/contracts";

export type CollectionErrorCode = DashboardBlockReasonContract["code"];

export class CollectionError extends Error {
  constructor(
    readonly code: CollectionErrorCode,
    readonly problem: string,
    readonly nextAction: string,
    options?: ErrorOptions,
  ) {
    super(problem, options);
  }

  toBlockReason(): DashboardBlockReasonContract {
    return {
      code: this.code,
      problem: this.problem,
      protectiveAction: "새 스냅샷을 정상 상태로 저장하지 않았고 모든 주문 기능을 차단했습니다.",
      nextAction: this.nextAction,
    };
  }
}
