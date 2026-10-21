import { describe, it, expect } from "vitest";
import {
  productPhotoPost,
  clip,
  TelegramChannelPublisher,
} from "../src/modules/telegram-channel/publisher.js";
import { AdminCatalogService } from "../src/modules/admin/catalog/service.js";
import type { AdminCatalogRepository } from "../src/modules/admin/catalog/repository.js";
import type { AdminProductRecord } from "../src/modules/admin/catalog/types.js";
import type { PublicationStore } from "../src/modules/telegram-channel/store.js";

const date = new Date();
function product(): AdminProductRecord {
  return {
    id: "synthetic-product",
    categoryId: "category",
    nameRu: "РУССКОЕ ИМЯ",
    nameUz: "STENZO Hudi",
    descriptionRu: "РУССКОЕ ОПИСАНИЕ",
    descriptionUz: "Yumshoq va qulay.",
    slug: "stenzo-hudi",
    price: 210000,
    currency: "UZS",
    status: "ACTIVE",
    sourceUrl: "https://source.invalid/private",
    isFeatured: false,
    createdAt: date,
    updatedAt: date,
    category: {
      id: "category",
      nameRu: "Категория",
      nameUz: "Kiyim",
      slug: "kiyim",
      isActive: true,
      sortOrder: 0,
      createdAt: date,
      updatedAt: date,
    },
    images: [
      {
        id: "a",
        productId: "synthetic-product",
        url: "https://preview.invalid/media/products/aaaa.png",
        storageKey: "products/aaaa.png",
        sortOrder: 0,
        isPrimary: false,
        createdAt: date,
      },
      {
        id: "b",
        productId: "synthetic-product",
        url: "https://preview.invalid/media/products/bbbb.png",
        storageKey: "products/bbbb.png",
        sortOrder: 5,
        isPrimary: true,
        createdAt: date,
      },
    ],
    variants: ["XL", "S", "M", "S"].map((size, index) => ({
      id: String(index),
      productId: "synthetic-product",
      sku: "INTERNAL-SKU-" + index,
      size,
      color: index % 2 ? "Oq" : "Qora",
      stock: null,
      isActive: true,
      createdAt: date,
      updatedAt: date,
    })),
  };
}
const post = (p = product()) =>
  productPhotoPost(
    p,
    "https://preview.invalid",
    "synthetic_preview_bot",
    "synthetic_sales",
  );
describe("UZ photo post contract", () => {
  it("uses only UZ fields, exact grouped UZS price, unique stable sizes and colors", () => {
    const result = post();
    expect(result.caption).toContain("STENZO Hudi");
    expect(result.caption).toContain("Yumshoq va qulay.");
    expect(result.caption).toContain("210 000 so‘m");
    expect(result.caption).toContain("Razmerlar: S / M / XL");
    expect(result.caption).toContain("Ranglar: Oq, Qora");
    expect(result.caption).not.toMatch(
      /РУССКОЕ|INTERNAL|SKU|source.invalid|synthetic-product|Cloudflare|D1/,
    );
  });
  it("preserves authored delivery terms and price without inventing a prepayment or delivery promise", () => {
    const p = product();
    p.price = 290000;
    p.descriptionUz = "📦 Buyurtma asosida\n🚚 Yetkazib berish: 7–10 kun";
    const { caption } = post(p);
    expect(caption).toContain("💰 Narxi: 290 000 so‘m + kargo");
    expect(caption).toContain(p.descriptionUz);
    expect(caption).not.toMatch(/10–12|50%/);
  });
  it("uses primary photo even when its sortOrder is later", () => {
    expect(post().photo).toContain("bbbb.png");
  });
  it("falls back to first sortOrder image when no primary exists", () => {
    const p = product();
    p.images.forEach((i) => {
      i.isPrimary = false;
    });
    expect(post(p).photo).toContain("aaaa.png");
  });
  it("uses official Main Mini App URL buttons and trusted sales config, never channel web_app buttons", () => {
    const keys = post().reply_markup.inline_keyboard[0]!;
    expect(keys).toEqual([
      {
        text: "Sotib olish",
        url: "https://t.me/synthetic_preview_bot?startapp=product_stenzo-hudi",
      },
      { text: "Administratorga yozish", url: "https://t.me/synthetic_sales" },
    ]);
    expect(JSON.stringify(keys)).not.toContain("web_app");
  });
  for (const status of ["DRAFT", "INACTIVE"] as const)
    it(`${status} cannot publish`, () => {
      const p = product();
      p.status = status;
      expect(() => post(p)).toThrow("PRODUCT_INACTIVE");
    });
  it("requires photo", () => {
    const p = product();
    p.images = [];
    expect(() => post(p)).toThrow("PHOTO_MISSING");
  });
  it("requires active variants and ignores inactive variant sizes/colors", () => {
    const p = product();
    p.variants.forEach((v) => {
      v.isActive = false;
    });
    expect(() => post(p)).toThrow("VARIANTS_MISSING");
    p.variants[0]!.isActive = true;
    expect(post(p).caption).toContain("Razmerlar: XL");
    expect(post(p).caption).not.toContain("Oq");
  });
  it("rejects missing UZ name and Cyrillic rather than falling back to RU", () => {
    for (const name of ["", "  ", "Русский"]) {
      const p = product();
      p.nameUz = name;
      expect(() => post(p)).toThrow("UZ_CONTENT_REQUIRED");
    }
    const p = product();
    p.descriptionUz = "Русский текст";
    expect(() => post(p)).toThrow("UZ_CONTENT_REQUIRED");
    p.descriptionUz = null;
    p.variants[0]!.color = "Черный";
    expect(() => post(p)).toThrow("UZ_CONTENT_REQUIRED");
  });
  it("requires positive integer UZS price", () => {
    for (const price of [0, -1, 1.5, NaN]) {
      const p = product();
      p.price = price;
      expect(() => post(p)).toThrow("PRICE_INVALID");
    }
  });
  it("rejects private/proof/external photo paths", () => {
    for (const url of [
      "https://preview.invalid/media/proofs/aaaa.png",
      "https://preview.invalid/api/payments/proof",
      "https://other.invalid/media/products/aaaa.png",
      "https://preview.invalid/media/products/aaaa.png?token=private",
    ]) {
      const p = product();
      p.images[1]!.url = url;
      expect(() => post(p)).toThrow("PHOTO_NOT_PUBLIC");
    }
  });
  it("rejects unsafe/overlong slug deep links", () => {
    for (const slug of [
      "../admin",
      "https://evil.invalid",
      "abc/def",
      "a".repeat(101),
      "%2Fadmin",
    ]) {
      const p = product();
      p.slug = slug;
      expect(() => post(p)).toThrow("INVALID_SLUG");
    }
  });
  it("bounds description/caption without splitting Unicode graphemes", () => {
    const p = product();
    p.descriptionUz = "O‘zbekcha 👩🏽‍💻 ".repeat(5000);
    const result = post(p);
    expect(result.caption.length).toBeLessThanOrEqual(1024);
    expect(result.caption).toContain("so‘m + kargo");
    expect(Buffer.from(result.caption).toString()).toBe(result.caption);
    expect(clip("👩🏽‍💻".repeat(5), 12)).toBe("👩🏽‍💻…");
  });
  it("omits color line for null colors", () => {
    const p = product();
    p.variants.forEach((v) => {
      v.color = null;
    });
    expect(post(p).caption).not.toContain("Ranglar");
  });
});
describe("activation preserves catalog state", () => {
  function fixture() {
    const p = product();
    p.status = "DRAFT";
    const repository = {
      getProduct: async () => p,
      setProductStatus: async (
        _actor: string,
        _id: string,
        status: AdminProductRecord["status"],
      ) => {
        p.status = status;
        return p;
      },
      updateProduct: async (
        _actor: string,
        _id: string,
        input: Partial<AdminProductRecord>,
      ) => {
        Object.assign(p, input);
        return p;
      },
    } as unknown as AdminCatalogRepository;
    return { p, repository };
  }
  it("attempts auto publish after ACTIVE and does not roll it back when Telegram fails", async () => {
    const f = fixture();
    let attempts = 0;
    const service = new AdminCatalogService(f.repository, undefined, {
      getPublication: async () => ({
        status: "NOT_PUBLISHED",
        retryAllowed: true,
      }),
      publishProduct: async () => {
        attempts++;
        expect(f.p.status).toBe("ACTIVE");
        throw new Error("private provider exception");
      },
    });
    const activated = await service.setProductActive(
      "actor",
      f.p.id,
      true,
      true,
    );
    expect(activated.status).toBe("ACTIVE");
    expect(activated.telegramPublication?.status).toBe("FAILED");
    expect(attempts).toBe(1);
    expect(JSON.stringify(activated.telegramPublication)).not.toContain(
      "private provider",
    );
  });
  it("activation without channel configuration succeeds with an explicit status", async () => {
    const f = fixture();
    const result = await new AdminCatalogService(f.repository).setProductActive(
      "actor",
      f.p.id,
      true,
      true,
    );
    expect(result.status).toBe("ACTIVE");
    expect(result.telegramPublication?.errorCode).toBe(
      "CHANNEL_NOT_CONFIGURED",
    );
  });
  it("ordinary ACTIVE metadata save is not a new publication trigger", async () => {
    const f = fixture();
    f.p.status = "ACTIVE";
    let attempts = 0;
    const service = new AdminCatalogService(f.repository, undefined, {
      getPublication: async () => ({
        status: "NOT_PUBLISHED",
        retryAllowed: true,
      }),
      publishProduct: async () => {
        attempts++;
        return { status: "PUBLISHED", retryAllowed: false };
      },
    });
    await service.updateProduct("actor", f.p.id, { nameUz: "Yangi nom" });
    expect(attempts).toBe(0);
  });
  it("PATCH transition from DRAFT to ACTIVE also attempts publishing", async () => {
    const f = fixture();
    let attempts = 0;
    const service = new AdminCatalogService(f.repository, undefined, {
      getPublication: async () => ({
        status: "NOT_PUBLISHED",
        retryAllowed: true,
      }),
      publishProduct: async () => {
        attempts++;
        return { status: "PUBLISHED", retryAllowed: false };
      },
    });
    await service.updateProduct("actor", f.p.id, { status: "ACTIVE" }, true);
    expect(attempts).toBe(1);
  });
  it("missing channel/sales configuration makes no network request and never exposes configuration", async () => {
    const p = product();
    const errors: string[] = [];
    const store = {
      recordFailure: async (
        _a: string,
        _p: string,
        _s: string,
        _c: string,
        code: string,
      ) => {
        errors.push(code);
      },
    } as unknown as PublicationStore;
    for (const config of [{}, { channel: "@synthetic_channel" }]) {
      const publisher = new TelegramChannelPublisher(
        store,
        { getProduct: async () => p },
        config,
        async () => {
          throw new Error("Unexpected network");
        },
      );
      const result = await publisher.publishProduct("actor", p.id);
      expect(result.status).toBe("NOT_CONFIGURED");
    }
    expect(errors).toEqual([
      "CHANNEL_NOT_CONFIGURED",
      "SALES_USERNAME_NOT_CONFIGURED",
    ]);
  });
});
