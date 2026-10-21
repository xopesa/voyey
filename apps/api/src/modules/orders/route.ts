import type { FastifyInstance, FastifyRequest } from "fastify";

import { createAdminGuard } from "../admin/authorization.js";
import { HttpError } from "../auth/errors.js";
import { createAuthGuard } from "../auth/middleware.js";
import type { JwtTokenService } from "../auth/token.js";
import type { UserService } from "../users/index.js";
import { OrderInvalidCursorError, OrderNotFoundError } from "./errors.js";
import {
  adminOrderListQuerySchema,
  orderListQuerySchema,
  publicOrderParamsSchema,
} from "./schemas.js";
import type { OrderService } from "./service.js";

function userId(request: FastifyRequest): string {
  const id = request.currentUser?.id;
  if (!id) throw new HttpError(401, "Invalid access token");
  return id;
}

async function mapOrderError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OrderNotFoundError)
      throw new HttpError(404, error.message);
    if (error instanceof OrderInvalidCursorError)
      throw new HttpError(400, error.message);
    throw error;
  }
}

export function registerOrderRoutes(
  app: FastifyInstance,
  service: OrderService,
  tokenService: JwtTokenService,
  userService: UserService,
  adminTokenService: JwtTokenService,
  adminUserService: UserService,
  adminTelegramIds: ReadonlySet<string>,
): void {
  const authGuard = createAuthGuard(tokenService, userService);
  const adminGuard = createAdminGuard(
    adminTokenService,
    adminUserService,
    adminTelegramIds,
  );

  app.get("/orders", { preHandler: authGuard }, async (request) => {
    const query = orderListQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Invalid orders query");
    return mapOrderError(() =>
      service.listForUser(userId(request), query.data),
    );
  });

  app.get("/orders/:publicId", { preHandler: authGuard }, async (request) => {
    const params = publicOrderParamsSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, "Invalid order id");
    return {
      order: await mapOrderError(() =>
        service.getForUser(userId(request), params.data.publicId),
      ),
    };
  });

  app.get("/admin/orders", { preHandler: adminGuard }, async (request) => {
    const query = adminOrderListQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Invalid orders query");
    return mapOrderError(() => service.listForAdmin(query.data));
  });

  app.get(
    "/admin/orders/:publicId",
    { preHandler: adminGuard },
    async (request) => {
      const params = publicOrderParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid order id");
      return {
        order: await mapOrderError(() =>
          service.getForAdmin(params.data.publicId),
        ),
      };
    },
  );
}
