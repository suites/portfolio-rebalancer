import { ENGINE_CONFIG } from "./application.tokens";
import { createEngineApplication } from "./bootstrap";
import type { EngineConfig } from "./config";

const app = await createEngineApplication();
const config = app.get<EngineConfig>(ENGINE_CONFIG);

if (config.VERCEL !== "1") app.enableShutdownHooks();

await app.listen(config.ENGINE_PORT, config.ENGINE_HOST);
