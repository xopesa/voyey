import type { FastifyInstance } from "fastify";

import {
  registerAdminCatalogModule,
  type AdminCatalogModuleDependencies,
} from "./admin/catalog/index.js";
import {
  registerAdminModule,
  type AdminModuleDependencies,
} from "./admin/index.js";
import {
  registerAuthModule,
  type AuthModuleDependencies,
} from "./auth/index.js";
import {
  registerCartModule,
  type CartModuleDependencies,
} from "./cart/index.js";
import {
  registerCatalogModule,
  type CatalogModuleDependencies,
} from "./catalog/index.js";
import {
  registerCheckoutModule,
  type CheckoutModuleDependencies,
} from "./checkout/index.js";
import { healthRoutes } from "./health/route.js";
import {
  registerOrderModule,
  type OrderModuleDependencies,
} from "./orders/index.js";
import {
  registerPaymentModule,
  type PaymentModuleDependencies,
} from "./payments/index.js";

export interface ModuleDependencies
  extends
    AuthModuleDependencies,
    AdminModuleDependencies,
    CatalogModuleDependencies,
    AdminCatalogModuleDependencies,
    CartModuleDependencies,
    CheckoutModuleDependencies,
    OrderModuleDependencies,
    PaymentModuleDependencies {}

export function registerModules(
  app: FastifyInstance,
  dependencies: ModuleDependencies = {},
): void {
  void app.register(healthRoutes);
  registerAuthModule(app, dependencies);
  registerAdminModule(app, dependencies);
  registerCatalogModule(app, dependencies);
  registerAdminCatalogModule(app, dependencies);
  registerCartModule(app, dependencies);
  registerCheckoutModule(app, dependencies);
  registerOrderModule(app, dependencies);
  registerPaymentModule(app, dependencies);
}
