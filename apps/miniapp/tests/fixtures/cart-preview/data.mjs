// Test data only. Never imported by production routes or seeded in PostgreSQL.
const { structuredClone } = globalThis;
export const cartFixture = {
  id: "fixture-cart",
  currency: "UZS",
  subtotal: 850000,
  updatedAt: "2026-09-30T00:00:00Z",
  items: [
    {
      id: "fixture-hoodie",
      quantity: 2,
      unitPrice: 285000,
      lineTotal: 570000,
      heightCm: null,
      weightKg: null,
      currency: "UZS",
      isAvailable: true,
      product: {
        id: "fixture-product-a",
        slug: "fixture-hoodie",
        nameRu: "Тестовое худи STENZO",
        nameUz: "STENZO test hudi",
        imageUrl: "/fixture-photo.svg",
      },
      variant: {
        id: "fixture-variant-a",
        sku: "TEST-A",
        size: "L",
        color: "Black",
        stock: 3,
      },
    },
    {
      id: "fixture-shirt",
      quantity: 2,
      unitPrice: 140000,
      lineTotal: 280000,
      heightCm: 175,
      weightKg: 70,
      currency: "UZS",
      isAvailable: true,
      product: {
        id: "fixture-product-b",
        slug: "fixture-shirt",
        nameRu: "Тестовая футболка",
        nameUz: "Test futbolka",
        imageUrl: null,
      },
      variant: {
        id: "fixture-variant-b",
        sku: "TEST-B",
        size: "M",
        color: null,
        stock: null,
      },
    },
  ],
};
export function scenarioCart(scenario) {
  const cart = structuredClone(cartFixture);
  if (scenario === "empty") {
    cart.items = [];
    cart.subtotal = 0;
  }
  if (scenario === "stock-changed") {
    cart.items[0].variant.stock = 1;
    cart.items[0].isAvailable = false;
  }
  if (scenario === "sold-out") {
    cart.items[0].variant.stock = 0;
    cart.items[0].isAvailable = false;
  }
  if (scenario === "broken-image")
    cart.items[0].product.imageUrl = "/missing-image.svg";
  if (scenario === "invalid") cart.subtotal = "bad";
  return cart;
}
