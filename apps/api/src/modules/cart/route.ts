import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { HttpError } from "../auth/errors.js";
import { createAuthGuard } from "../auth/middleware.js";
import type { JwtTokenService } from "../auth/token.js";
import type { UserService } from "../users/index.js";
import {
  CartItemNotFoundError,
  CartProductUnavailableError,
  CartQuantityLimitError,
  CartStockExceededError,
  CartVariantProductMismatchError,
  CartVariantUnavailableError,
} from "./errors.js";
import {
  addCartItemSchema,
  cartItemParamsSchema,
  patchCartItemSchema,
} from "./schemas.js";
import type { CartService } from "./service.js";

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, message);
  return result.data;
}

function userId(request: FastifyRequest): string {
  const id = request.currentUser?.id;
  if (!id) throw new HttpError(401, "Invalid access token");
  return id;
}

async function mapCartError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CartItemNotFoundError)
      throw new HttpError(404, error.message);
    if (
      error instanceof CartProductUnavailableError ||
      error instanceof CartVariantUnavailableError ||
      error instanceof CartVariantProductMismatchError ||
      error instanceof CartStockExceededError ||
      error instanceof CartQuantityLimitError
    ) {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}

export function registerCartRoutes(
  app: FastifyInstance,
  service: CartService,
  tokenService: JwtTokenService,
  userService: UserService,
): void {
  const guard = createAuthGuard(tokenService, userService);

  app.get("/cart", { preHandler: guard }, async (request) => ({
    cart: await service.get(userId(request)),
  }));

  app.post("/cart/items", { preHandler: guard }, async (request, reply) => {
    const input = parse(
      addCartItemSchema,
      request.body,
      "Invalid cart item payload",
    );
    const cart = await mapCartError(() =>
      service.addItem(userId(request), input),
    );
    return reply.status(201).send({ cart });
  });

  app.patch("/cart/items/:id", { preHandler: guard }, async (request) => {
    const { id } = parse(
      cartItemParamsSchema,
      request.params,
      "Invalid cart item id",
    );
    const input = parse(
      patchCartItemSchema,
      request.body,
      "Invalid cart item payload",
    );
    return {
      cart: await mapCartError(() =>
        service.updateItem(userId(request), id, input),
      ),
    };
  });

  app.delete("/cart/items/:id", { preHandler: guard }, async (request) => {
    const { id } = parse(
      cartItemParamsSchema,
      request.params,
      "Invalid cart item id",
    );
    return {
      cart: await mapCartError(() => service.deleteItem(userId(request), id)),
    };
  });

  app.delete("/cart", { preHandler: guard }, async (request) => ({
    cart: await service.clear(userId(request)),
  }));
}
