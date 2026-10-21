import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CartProductUnavailableError,
  CartQuantityLimitError,
  CartStockExceededError,
  CartVariantProductMismatchError,
  CartVariantUnavailableError,
} from "../cart/errors.js";
import { HttpError } from "../auth/errors.js";
import { createAuthGuard } from "../auth/middleware.js";
import type { JwtTokenService } from "../auth/token.js";
import { idempotencyKeySchema, recipientSchema } from "../orders/schemas.js";
import type { UserService } from "../users/index.js";
import {
  CheckoutAmountLimitError,
  CheckoutConflictError,
  CheckoutEmptyCartError,
  CheckoutMeasurementsError,
} from "./errors.js";
import type { CheckoutService } from "./service.js";

function userId(request: FastifyRequest): string {
  const id = request.currentUser?.id;
  if (!id) throw new HttpError(401, "Invalid access token");
  return id;
}

export function registerCheckoutRoutes(
  app: FastifyInstance,
  service: CheckoutService,
  tokenService: JwtTokenService,
  userService: UserService,
): void {
  const guard = createAuthGuard(tokenService, userService);
  app.post("/checkout", { preHandler: guard }, async (request, reply) => {
    const checkoutSchema = recipientSchema.extend({
      promoCode: z.string().trim().min(3).max(32).optional(),
    });
    const recipient = checkoutSchema.safeParse(request.body);
    if (!recipient.success)
      throw new HttpError(400, "Invalid checkout payload");
    const key = idempotencyKeySchema.safeParse(
      request.headers["idempotency-key"],
    );
    if (!key.success)
      throw new HttpError(400, "A valid Idempotency-Key header is required");
    try {
      const { promoCode, ...delivery } = recipient.data;
      const order = await service.checkout(
        userId(request),
        key.data,
        delivery,
        promoCode,
      );
      return reply.status(201).send({ order });
    } catch (error) {
      if (error instanceof CheckoutMeasurementsError)
        throw new HttpError(409, error.message);
      if (error instanceof CheckoutEmptyCartError)
        throw new HttpError(409, error.message);
      if (
        error instanceof CartProductUnavailableError ||
        error instanceof CartVariantUnavailableError ||
        error instanceof CartVariantProductMismatchError ||
        error instanceof CartStockExceededError ||
        error instanceof CartQuantityLimitError ||
        error instanceof CheckoutAmountLimitError ||
        error instanceof CheckoutConflictError
      ) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  });
}
