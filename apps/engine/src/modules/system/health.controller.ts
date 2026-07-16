import { Controller, Get, Inject } from "@nestjs/common";

import { OperationalConfigService } from "../operational-config/application/operational-config.service";

@Controller("internal/v1")
export class HealthController {
  constructor(
    @Inject(OperationalConfigService)
    private readonly operationalConfig: OperationalConfigService,
  ) {}

  @Get("health")
  async health() {
    const operational = await this.operationalConfig.current();
    return {
      status: operational.state === "UNAVAILABLE" ? ("degraded" as const) : ("ok" as const),
      executionMode: operational.activeVersion?.config.mode ?? "PAPER",
      killSwitch: operational.killSwitch,
      livePromotion: operational.livePromotion,
      liveOrdersEnabled: operational.liveOrdersEnabled,
    };
  }
}
