import { Module } from "@nestjs/common";

import { ENGINE_CONFIG } from "./engine-config.token";
import { loadEngineConfigFromProcess } from "./engine.config";

@Module({
  providers: [{ provide: ENGINE_CONFIG, useFactory: loadEngineConfigFromProcess }],
  exports: [ENGINE_CONFIG],
})
export class EngineConfigModule {}
