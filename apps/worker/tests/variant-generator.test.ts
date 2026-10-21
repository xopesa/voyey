import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVariantGeneration,
  normalizeVariantGenerator,
  suggestColorCode,
  variantCombinations,
  VariantGeneratorValidationError,
  type VariantGeneratorInput,
} from "@stenzo/shared";
import { D1VariantGenerator } from "../../api/src/d1/variant-generator.js";
import { D1AdminCatalogRepository } from "../../api/src/d1/repositories.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { HttpError } from "../../api/src/modules/auth/errors.js";
import { isolatedD1 } from "./helpers/sqlite.js";

const input = (
  change: Partial<VariantGeneratorInput> = {},
): VariantGeneratorInput => ({
  baseSku: "SW-RISE",
  sizes: ["S", "M", "L", "XL"],
  colors: [],
  stock: null,
  isActive: true,
  ...change,
});
const colors = [
  { color: "Cream", code: "CRM" },
  { color: "Black", code: "BLK" },
];
function invalid(value: VariantGeneratorInput, code: string) {
  assert.throws(
    () => normalizeVariantGenerator(value),
    (e) => e instanceof VariantGeneratorValidationError && e.code === code,
  );
}
test("base and sizes normalize only trim/uppercase; duplicates preserve user order", () => {
  const n = normalizeVariantGenerator(
    input({ baseSku: " sw-rise ", sizes: [" xl ", "m", "XL", "30", "m"] }),
  );
  assert.equal(n.baseSku, "SW-RISE");
  assert.deepEqual(n.sizes, ["XL", "M", "30"]);
});
test("unsafe bases rejected", () => {
  for (const baseSku of [
    "",
    "SW RISE",
    "SW_RISE",
    "SW/RISE",
    "ШИМ",
    "ß",
    "ı",
    "-SW",
    "SW-",
    "SW--RISE",
  ])
    invalid(input({ baseSku }), "invalidBaseSku");
});
test("unsafe sizes rejected without silently changing business size", () => {
  for (const sizes of [
    [],
    [""],
    ["X L"],
    ["X/L"],
    ["XL_1"],
    ["ЎЛЧАМ"],
    ["ß"],
    ["X".repeat(51)],
  ])
    invalid(input({ sizes }), "invalidGeneratorSizes");
});
for (const [language, names] of Object.entries({
  en: ["Black", "White", "Cream", "Beige", "Grey"],
  ru: ["Чёрный", "Белый", "Кремовый", "Бежевый", "Серый"],
  uz: ["Qora", "Oq", "Krem", "Bej", "Kulrang"],
}))
  test(`${language} core color mappings are case insensitive and trimmed`, () => {
    assert.deepEqual(
      names.map(
        (color) => suggestColorCode(" " + color.toLowerCase() + " ").code,
      ),
      ["BLK", "WHT", "CRM", "BEG", "GRY"],
    );
  });
test("all remaining required RU/UZ/EN mappings and Uzbek apostrophes", () => {
  for (const [code, names] of Object.entries({
    GRN: ["Green", "Зелёный", "Yashil"],
    BLU: ["Blue", "Синий", "Ko‘k", "Ko'k", "Kok"],
    NVY: ["Navy"],
    RED: ["Red", "Красный", "Qizil"],
    BRN: ["Brown", "Коричневый", "Jigarrang"],
    PNK: ["Pink", "Розовый", "Pushti"],
    PUR: ["Purple", "Фиолетовый", "Binafsha"],
    YLW: ["Yellow", "Жёлтый", "Sariq"],
    ORG: ["Orange", "Оранжевый", "To‘q sariq"],
  }))
    for (const name of names)
      assert.deepEqual(suggestColorCode(name), { code, requiresReview: false });
});
test("unknown codes require explicit review or manual edit; no random non-Latin fallback", () => {
  assert.deepEqual(suggestColorCode("Olive"), {
    code: "OLIV",
    requiresReview: true,
  });
  assert.deepEqual(suggestColorCode("Оливковый"), {
    code: "",
    requiresReview: true,
  });
  invalid(
    input({ colors: [{ color: "Olive", code: "OLIV" }] }),
    "colorReviewRequired",
  );
  assert.equal(
    normalizeVariantGenerator(
      input({ colors: [{ color: "Olive", code: "olv", reviewed: true }] }),
    ).colors[0]!.code,
    "OLV",
  );
});
test("invalid color codes rejected; duplicate colors deduped but ambiguous codes rejected", () => {
  for (const code of ["A", "TOOLONG", "BL-K", "ЧЁР", "A B", "A_B", "ß"])
    invalid(input({ colors: [{ color: "Black", code }] }), "invalidColorCode");
  assert.equal(
    normalizeVariantGenerator(input({ colors: [colors[0]!, colors[0]!] }))
      .colors.length,
    1,
  );
  invalid(
    input({
      colors: [
        { color: "Cream", code: "XX" },
        { color: "Black", code: "XX" },
      ],
    }),
    "generatorDuplicateColor",
  );
});
test("no-color SKUs contain neither NONE nor empty color segment", () => {
  const rows = variantCombinations(normalizeVariantGenerator(input()));
  assert.deepEqual(
    rows.map((r) => r.sku),
    ["SW-RISE-S", "SW-RISE-M", "SW-RISE-L", "SW-RISE-XL"],
  );
  assert.ok(rows.every((r) => r.color === null));
});
test("2 colors by 4 sizes gives exactly 8 SKUs in user order; display color preserved", () => {
  const n = normalizeVariantGenerator(input({ colors }));
  assert.deepEqual(
    variantCombinations(n).map((r) => r.sku),
    [
      "SW-RISE-CRM-S",
      "SW-RISE-CRM-M",
      "SW-RISE-CRM-L",
      "SW-RISE-CRM-XL",
      "SW-RISE-BLK-S",
      "SW-RISE-BLK-M",
      "SW-RISE-BLK-L",
      "SW-RISE-BLK-XL",
    ],
  );
  const display = "  CrEaM  ";
  assert.equal(
    variantCombinations(
      normalizeVariantGenerator(
        input({ colors: [{ color: display, code: "crm" }] }),
      ),
    )[0]!.color,
    display,
  );
});
test("100 character boundary and combination/binding budget enforced", () => {
  assert.equal(
    variantCombinations(
      normalizeVariantGenerator(
        input({ baseSku: "A".repeat(98), sizes: ["S"] }),
      ),
    )[0]!.sku.length,
    100,
  );
  invalid(
    input({ baseSku: "A".repeat(99), sizes: ["S"] }),
    "generatorSkuLength",
  );
  invalid(
    input({
      sizes: Array.from({ length: 40 }, (_, i) => String(i)),
      colors: [...colors, { color: "White", code: "WHT" }],
    }),
    "generatorLimit",
  );
});
test("classification preserves existing size/color even with historical SKU, but reports other global SKU conflicts", () => {
  const n = normalizeVariantGenerator(
    input({ sizes: ["S", "M"], colors: [colors[0]!] }),
  );
  const existing = [
    { id: "old", size: " s ", color: "cream", sku: "HISTORICAL" },
  ];
  const rows = classifyVariantGeneration(n, existing, [
    { id: "other", sku: "SW-RISE-CRM-M" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.status),
    ["EXISTS", "CONFLICT"],
  );
  assert.equal(rows[0]!.existingSku, "HISTORICAL");
});
test("invalid stock values rejected", () => {
  for (const stock of [-1, 0.5, NaN, 2147483648])
    invalid(input({ stock }), "invalidInteger");
});

async function fixture(
  run: (
    f: ReturnType<typeof isolatedD1>,
    generator: D1VariantGenerator,
  ) => Promise<void>,
) {
  const f = isolatedD1();
  try {
    f.sqlite
      .exec(`INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('category','Test','Test','test',1);
      INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,updatedAt) VALUES('product','category','Test','Test','test',100,1),('other','category','Other','Other','other',100,1);`);
    await f.run(() => run(f, new D1VariantGenerator()));
  } finally {
    f.sqlite.close();
  }
}
test("preview performs no writes; apply inserts 8; repeated preview EXISTS/apply zero; one audit per Apply", async () =>
  fixture(async (f, generator) => {
    const raw = input({ colors });
    const revision = f.sqlite.prepare("SELECT version FROM _Revision").get()!
      .version;
    assert.ok(
      (await generator.preview("product", raw)).rows.every(
        (r) => r.status === "NEW",
      ),
    );
    assert.equal(
      f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
      revision,
    );
    const first = await generator.apply(WEB_ADMIN_ACTOR, "product", raw);
    assert.equal(first.createdCount, 8);
    const before = f.sqlite
      .prepare("SELECT * FROM ProductVariant ORDER BY id")
      .all();
    assert.ok(
      (await generator.preview("product", raw)).rows.every(
        (r) => r.status === "EXISTS",
      ),
    );
    assert.equal(
      (await generator.apply(WEB_ADMIN_ACTOR, "product", raw)).createdCount,
      0,
    );
    assert.deepEqual(
      f.sqlite.prepare("SELECT * FROM ProductVariant ORDER BY id").all(),
      before,
    );
    const audits = f.sqlite
      .prepare("SELECT * FROM AuditLog WHERE action='variant.generate'")
      .all();
    assert.equal(audits.length, 2);
    const metadata = JSON.parse(String(audits[0]!.metadata));
    assert.equal(audits[0]!.entityId, "product");
    assert.equal(audits[0]!.entityType, "Product");
    assert.equal(metadata.createdCount, 8);
    assert.equal(metadata.requestedCount, 8);
    assert.equal(metadata.baseSku, "SW-RISE");
    assert.deepEqual(metadata.sizes, raw.sizes);
    assert.deepEqual(metadata.colors, colors);
  }));
for (const stock of [null, 0, 17])
  test(`stock ${stock} and inactive selection stored exactly; existing variants untouched`, async () =>
    fixture(async (f, generator) => {
      f.sqlite.exec(
        `INSERT INTO ProductVariant(id,productId,sku,size,color,stock,isActive,updatedAt) VALUES('old','product','OLD-SKU','S',NULL,4,0,1);`,
      );
      const before = f.sqlite
        .prepare("SELECT * FROM ProductVariant WHERE id='old'")
        .get();
      const result = await generator.apply(
        WEB_ADMIN_ACTOR,
        "product",
        input({ stock, isActive: false }),
      );
      assert.equal(result.createdCount, 3);
      assert.equal(result.existingCount, 1);
      assert.deepEqual(
        f.sqlite.prepare("SELECT * FROM ProductVariant WHERE id='old'").get(),
        before,
      );
      for (const row of result.variants.filter((r) => r.id !== "old")) {
        assert.equal(row.stock, stock);
        assert.equal(row.isActive, false);
      }
    }));
test("default active true and null stock stored", async () =>
  fixture(async (_f, generator) => {
    const r = await generator.apply(WEB_ADMIN_ACTOR, "product", input());
    assert.ok(r.variants.every((v) => v.isActive && v.stock === null));
  }));
test("100 combinations fit D1 parameter budget and create all rows in one operation", async () =>
  fixture(async (f, generator) => {
    const result = await generator.apply(
      WEB_ADMIN_ACTOR,
      "product",
      input({
        sizes: Array.from({ length: 20 }, (_, i) => String(i + 30)),
        colors: [
          ...colors,
          { color: "White", code: "WHT" },
          { color: "Red", code: "RED" },
          { color: "Blue", code: "BLU" },
        ],
      }),
    );
    assert.equal(result.createdCount, 100);
    assert.equal(result.variants.length, 100);
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM AuditLog").get()!.n,
      1,
    );
  }));
test("global SKU conflict blocks entire Apply, with no audit or partial rows", async () =>
  fixture(async (f, generator) => {
    f.sqlite.exec(
      `INSERT INTO ProductVariant(id,productId,sku,size,updatedAt) VALUES('conflict','other','SW-RISE-XL','X',1);`,
    );
    assert.equal(
      (await generator.preview("product", input())).rows.at(-1)!.status,
      "CONFLICT",
    );
    await assert.rejects(
      () => generator.apply(WEB_ADMIN_ACTOR, "product", input()),
      (e) => e instanceof HttpError && e.statusCode === 409,
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM ProductVariant").get()!.n,
      1,
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM AuditLog").get()!.n,
      0,
    );
  }));
test("same product other size/color also conflicts; server revalidates after preview", async () =>
  fixture(async (f, generator) => {
    await generator.preview("product", input());
    f.sqlite.exec(
      `INSERT INTO ProductVariant(id,productId,sku,size,updatedAt) VALUES('conflict','product','SW-RISE-XL','OTHER',1);`,
    );
    await assert.rejects(
      () => generator.apply(WEB_ADMIN_ACTOR, "product", input()),
      (e) => e instanceof HttpError && e.statusCode === 409,
    );
    await assert.rejects(
      () =>
        generator.apply(
          WEB_ADMIN_ACTOR,
          "product",
          input({ baseSku: "BAD_BASE" }),
        ),
      VariantGeneratorValidationError,
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM ProductVariant").get()!.n,
      1,
    );
  }));
test("unexpected failure in a later insert chunk rolls back all variants and audit", async () =>
  fixture(async (f, generator) => {
    f.sqlite.exec(
      `CREATE TRIGGER fail_last_variant BEFORE INSERT ON ProductVariant WHEN NEW.sku='SW-RISE-WHT-XL' BEGIN SELECT RAISE(ABORT,'fixture forced failure'); END;`,
    );
    await assert.rejects(() =>
      generator.apply(
        WEB_ADMIN_ACTOR,
        "product",
        input({ colors: [...colors, { color: "White", code: "WHT" }] }),
      ),
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM ProductVariant").get()!.n,
      0,
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM AuditLog").get()!.n,
      0,
    );
  }));
test("historical OrderItem snapshots remain byte-for-byte unchanged", async () =>
  fixture(async (f, generator) => {
    f.sqlite
      .exec(`INSERT INTO ProductVariant(id,productId,sku,size,color,stock,isActive,updatedAt) VALUES('old','product','CURRENT-OLD','S',NULL,4,0,1);
    INSERT INTO User(id,telegramId,updatedAt) VALUES('buyer','999',1);
    INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,total,subtotal,requiredPrepayment,paidAmount,remainingAmount,updatedAt)
    VALUES('order','FIXTURE','buyer','fixture','AWAITING_PREPAYMENT','Buyer','+998900000000','Test','Test',100,100,50,0,50,1);
    INSERT INTO OrderItem(id,orderId,productId,variantId,productNameRu,productNameUz,productSlug,sku,size,color,unitPrice,quantity,lineTotal)
    VALUES('item','order','product','old','Snapshot','Snapshot','old-product','HISTORICAL-SKU','S','Historical',100,1,100);`);
    const before = f.sqlite.prepare("SELECT * FROM OrderItem").all();
    await generator.apply(WEB_ADMIN_ACTOR, "product", input());
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM OrderItem").all(), before);
    assert.equal(
      f.sqlite.prepare("SELECT sku FROM ProductVariant WHERE id='old'").get()!
        .sku,
      "CURRENT-OLD",
    );
  }));
test("audit failure rolls back all generated variants", async () =>
  fixture(async (f, generator) => {
    f.sqlite.exec(
      `CREATE TRIGGER fail_generator_audit BEFORE INSERT ON AuditLog WHEN NEW.action='variant.generate' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;`,
    );
    await assert.rejects(() =>
      generator.apply(WEB_ADMIN_ACTOR, "product", input()),
    );
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM ProductVariant").get()!.n,
      0,
    );
  }));
for (const secondProduct of ["product", "other"])
  test(`concurrent generation (${secondProduct}) yields one success, one controlled 409, no partials`, async () =>
    fixture(async (f, generator) => {
      const outcomes = await Promise.allSettled([
        generator.apply(WEB_ADMIN_ACTOR, "product", input()),
        generator.apply(WEB_ADMIN_ACTOR, secondProduct, input()),
      ]);
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = outcomes.find((r) => r.status === "rejected");
      assert.ok(
        rejected?.status === "rejected" &&
          rejected.reason instanceof HttpError &&
          rejected.reason.statusCode === 409,
      );
      assert.equal(
        f.sqlite.prepare("SELECT count(*) n FROM ProductVariant").get()!.n,
        4,
      );
      assert.equal(
        f.sqlite.prepare("SELECT count(*) n FROM AuditLog").get()!.n,
        1,
      );
    }));
test("manual create/edit/activate/deactivate still works on generated variants", async () =>
  fixture(async (_f, generator) => {
    const repo = new D1AdminCatalogRepository();
    const manual = await repo.createVariant(WEB_ADMIN_ACTOR, "product", {
      sku: "MANUAL",
      size: "XS",
      color: "Beige",
      stock: 5,
      isActive: true,
    });
    const result = await generator.apply(WEB_ADMIN_ACTOR, "product", input());
    const generated = result.variants.find((r) => r.size === "M")!;
    const edited = await repo.updateVariant(WEB_ADMIN_ACTOR, generated.id, {
      sku: "MANUAL-EDIT",
      size: "M1",
      color: "Custom",
      stock: 2,
    });
    assert.equal(edited.sku, "MANUAL-EDIT");
    assert.equal(edited.stock, 2);
    assert.equal(edited.size, "M1");
    assert.equal(edited.color, "Custom");
    assert.equal(
      (await repo.setVariantActive(WEB_ADMIN_ACTOR, generated.id, false))
        .isActive,
      false,
    );
    assert.equal(
      (await repo.setVariantActive(WEB_ADMIN_ACTOR, generated.id, true))
        .isActive,
      true,
    );
    assert.ok(result.variants.some((r) => r.id === manual.id));
  }));
