import { Module } from "@nestjs/common";

import { PortfolioModule } from "./modules/portfolio/portfolio.module";
import { SystemModule } from "./modules/system/system.module";

@Module({
  imports: [SystemModule, PortfolioModule],
})
export class AppModule {}
