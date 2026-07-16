import { Module } from "@nestjs/common";

import { OperationalConfigModule } from "./modules/operational-config/operational-config.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PortfolioModule } from "./modules/portfolio/portfolio.module";
import { SystemModule } from "./modules/system/system.module";

@Module({
  imports: [SystemModule, PortfolioModule, OperationalConfigModule, OrdersModule],
})
export class AppModule {}
