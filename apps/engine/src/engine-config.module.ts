import { Global, Module } from "@nestjs/common";

import { ENGINE_CONFIG } from "./application.tokens";
import { loadEngineConfigFromProcess } from "./config";

@Global()
@Module({
  providers: [{ provide: ENGINE_CONFIG, useFactory: loadEngineConfigFromProcess }],
  exports: [ENGINE_CONFIG],
})
export class EngineConfigModule {}
