import { createEngineApplication } from "./bootstrap";
import { ENGINE_CONFIG } from "./config/engine-config.token";
import type { EngineConfig } from "./config/engine.config";

const app = await createEngineApplication();
const config = app.get<EngineConfig>(ENGINE_CONFIG);

if (config.VERCEL !== "1") app.enableShutdownHooks();

await app.listen(config.ENGINE_PORT, config.ENGINE_HOST);
