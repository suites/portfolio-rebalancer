import { Controller, Get } from "@nestjs/common";

@Controller("internal/v1")
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok" as const, liveOrdersEnabled: false as const };
  }
}
