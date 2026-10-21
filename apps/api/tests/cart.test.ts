import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { assertPurchasable } from "../src/modules/cart/domain.js";
import { CartItemNotFoundError } from "../src/modules/cart/errors.js";
import type { CartRepository } from "../src/modules/cart/repository.js";
import { registerCartRoutes } from "../src/modules/cart/route.js";
import { CartService } from "../src/modules/cart/service.js";
import type {
  AddCartItemInput,
  CartItemRecord,
  CartProductRecord,
  CartRecord,
  CartVariantRecord,
  PatchCartItemInput,
} from "../src/modules/cart/types.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { createTestUserService } from "./helpers/auth.js";

const timestamp = new Date("2026-09-29T00:00:00.000Z");
const jwtSecret = "stenzo-cart-test-secret-longer-than-32-characters";

function makeProduct(
  id: string,
  status: CartProductRecord["status"] = "ACTIVE",
  categoryActive = true,
): CartProductRecord {
  return {
    id,
    nameRu: `Товар ${id}`,
    nameUz: `Mahsulot ${id}`,
    slug: `product-${id}`,
    price: 101,
    currency: "UZS",
    status,
    category: { isActive: categoryActive },
    images: [
      { url: `https://media.example/${id}.jpg`, isPrimary: true, sortOrder: 0 },
    ],
  };
}

function makeVariant(
  id: string,
  productId: string,
  overrides: Partial<CartVariantRecord> = {},
): CartVariantRecord {
  return {
    id,
    productId,
    sku: `SKU-${id}`,
    size: "M",
    color: "Black",
    stock: 5,
    isActive: true,
    ...overrides,
  };
}

class MemoryCartRepository implements CartRepository {
  public readonly products = new Map<string, CartProductRecord>([
    ["p1", makeProduct("p1")],
    ["p-inactive", makeProduct("p-inactive", "INACTIVE")],
    ["p-hidden-category", makeProduct("p-hidden-category", "ACTIVE", false)],
    ["p2", makeProduct("p2")],
  ]);
  public readonly variants = new Map<string, CartVariantRecord>([
    ["v1", makeVariant("v1", "p1")],
    ["v-inactive", makeVariant("v-inactive", "p1", { isActive: false })],
    ["v-p2", makeVariant("v-p2", "p2")],
  ]);
  private readonly carts = new Map<string, CartRecord>();
  private nextId = 1;

  public getOrCreate(userId: string): Promise<CartRecord> {
    let cart = this.carts.get(userId);
    if (!cart) {
      cart = {
        id: `cart-${userId}`,
        userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [],
      };
      this.carts.set(userId, cart);
    }
    return Promise.resolve(cart);
  }

  public async addItem(
    userId: string,
    input: AddCartItemInput,
  ): Promise<CartRecord> {
    const cart = await this.getOrCreate(userId);
    const product = this.products.get(input.productId) ?? null;
    const variant = this.variants.get(input.variantId) ?? null;
    const existing = cart.items.find(
      (item) => item.variantId === input.variantId,
    );
    const quantity = (existing?.quantity ?? 0) + input.quantity;
    assertPurchasable(product, variant, input.productId, quantity);
    if (existing) {
      existing.quantity = quantity;
      existing.heightCm = input.heightCm;
      existing.weightKg = input.weightKg;
    } else {
      cart.items.push({
        id: `item-${this.nextId++}`,
        cartId: cart.id,
        productId: input.productId,
        variantId: input.variantId,
        quantity,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        createdAt: timestamp,
        updatedAt: timestamp,
        product: product!,
        variant: variant!,
      });
    }
    return cart;
  }

  public async updateItem(
    userId: string,
    itemId: string,
    input: PatchCartItemInput,
  ): Promise<CartRecord> {
    const cart = await this.getOrCreate(userId);
    const item = cart.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new CartItemNotFoundError();
    assertPurchasable(
      item.product,
      item.variant,
      item.productId,
      input.quantity ?? item.quantity,
    );
    Object.assign(item, input);
    return cart;
  }

  public async deleteItem(userId: string, itemId: string): Promise<CartRecord> {
    const cart = await this.getOrCreate(userId);
    const index = cart.items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new CartItemNotFoundError();
    cart.items.splice(index, 1);
    return cart;
  }

  public async clear(userId: string): Promise<CartRecord> {
    const cart = await this.getOrCreate(userId);
    cart.items = [];
    return cart;
  }

  public async seedItem(userId: string): Promise<CartItemRecord> {
    const cart = await this.addItem(userId, {
      productId: "p1",
      variantId: "v1",
      quantity: 1,
      heightCm: null,
      weightKg: null,
    });
    return cart.items[0]!;
  }
}

async function createFixture() {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  const repository = new MemoryCartRepository();
  const tokenService = new JwtTokenService(jwtSecret);
  registerCartRoutes(
    app,
    new CartService(repository),
    tokenService,
    createTestUserService(),
  );
  return {
    app,
    repository,
    userOneToken: await tokenService.issue("user-1"),
    userTwoToken: await tokenService.issue("user-2"),
  };
}

describe("cart API", () => {
  it("adds once per variant, increments quantity, updates and deletes only for the owner", async () => {
    const { app, userOneToken, userTwoToken } = await createFixture();
    const userOneHeaders = { authorization: `Bearer ${userOneToken}` };
    const payload = {
      productId: "p1",
      variantId: "v1",
      quantity: 1,
      heightCm: 180,
      weightKg: 80,
    };
    const first = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers: userOneHeaders,
      payload,
    });
    const itemId = first.json<{ cart: { items: Array<{ id: string }> } }>().cart
      .items[0]!.id;
    const second = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers: userOneHeaders,
      payload: { ...payload, heightCm: 181 },
    });
    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/cart/items/${itemId}`,
      headers: { authorization: `Bearer ${userTwoToken}` },
      payload: { quantity: 2 },
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/cart/items/${itemId}`,
      headers: userOneHeaders,
      payload: { quantity: 3, weightKg: 82 },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/cart/items/${itemId}`,
      headers: userOneHeaders,
    });

    expect(second.json()).toMatchObject({
      cart: { items: [{ quantity: 2, heightCm: 181 }] },
    });
    expect(
      second.json<{ cart: { items: unknown[] } }>().cart.items,
    ).toHaveLength(1);
    expect(foreignPatch.statusCode).toBe(404);
    expect(updated.json()).toMatchObject({
      cart: { items: [{ quantity: 3, weightKg: 82 }] },
    });
    expect(
      deleted.json<{ cart: { items: unknown[] } }>().cart.items,
    ).toHaveLength(0);
    await app.close();
  });

  it("rejects inactive products, inactive variants, mismatches and insufficient stock", async () => {
    const { app, userOneToken } = await createFixture();
    const headers = { authorization: `Bearer ${userOneToken}` };
    const add = (payload: object) =>
      app.inject({ method: "POST", url: "/cart/items", headers, payload });

    expect(
      (await add({ productId: "p-inactive", variantId: "v1", quantity: 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await add({
          productId: "p-hidden-category",
          variantId: "v1",
          quantity: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await add({ productId: "p1", variantId: "v-inactive", quantity: 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await add({ productId: "p1", variantId: "v-p2", quantity: 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await add({ productId: "p1", variantId: "v1", quantity: 6 })).statusCode,
    ).toBe(409);
    await app.close();
  });

  it("validates per-item height and weight", async () => {
    const { app, userOneToken } = await createFixture();
    const headers = { authorization: `Bearer ${userOneToken}` };
    const tooShort = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers,
      payload: { productId: "p1", variantId: "v1", quantity: 1, heightCm: 99 },
    });
    const tooHeavy = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers,
      payload: { productId: "p1", variantId: "v1", quantity: 1, weightKg: 301 },
    });

    expect(tooShort.statusCode).toBe(400);
    expect(tooHeavy.statusCode).toBe(400);
    await app.close();
  });

  it("uses the backend product price and rejects client price fields", async () => {
    const { app, userOneToken } = await createFixture();
    const headers = { authorization: `Bearer ${userOneToken}` };
    const forged = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers,
      payload: { productId: "p1", variantId: "v1", quantity: 2, price: 1 },
    });
    const valid = await app.inject({
      method: "POST",
      url: "/cart/items",
      headers,
      payload: { productId: "p1", variantId: "v1", quantity: 2 },
    });

    expect(forged.statusCode).toBe(400);
    expect(valid.json()).toMatchObject({
      cart: { subtotal: 202, items: [{ unitPrice: 101, lineTotal: 202 }] },
    });
    await app.close();
  });
});
