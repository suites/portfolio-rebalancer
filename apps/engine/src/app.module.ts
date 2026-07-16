import { Module } from "@nestjs/common";

import { PortfolioModule } from "./portfolio.module";

@Module({
  imports: [PortfolioModule],
})
export class AppModule {}
