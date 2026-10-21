import test from "node:test";
import assert from "node:assert/strict";
import {
  BannerService,
  parseBanner,
  publicBanners,
} from "../../api/src/modules/marketing/banners.js";
import { ImageStorageService } from "../../api/src/modules/media/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { png, jpeg, webp } from "../../api/tests/fixtures/images.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";

function fixture() {
  const db = isolatedD1(),
    files = new Map<string, Buffer>(),
    deleted: string[] = [];
  const service = new BannerService(
    new ImageStorageService(
      {
        async upload(input) {
          files.set(input.key, input.data);
        },
        async delete(key) {
          deleted.push(key);
          files.delete(key);
        },
        async read(key) {
          return files.get(key)!;
        },
        getPublicUrl: (key) => "https://preview.invalid/media/" + key,
      },
      5242880,
    ),
  );
  const input = parseBanner({
    titleRu: "Новая коллекция",
    titleUz: "Yangi kolleksiya",
  });
  return { ...db, service, files, deleted, input };
}
for (const [mime, data] of [
  ["image/png", png],
  ["image/jpeg", jpeg],
  ["image/webp", webp],
] as const)
  test(`banner ${mime} upload uses existing structural validation and public DTO hides storage/internal IDs`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const draft = await f.service.create(WEB_ADMIN_ACTOR, f.input);
        assert.equal((await publicBanners()).length, 0);
        await assert.rejects(
          f.service.setActive(WEB_ADMIN_ACTOR, draft.id, true),
        );
        await f.service.upload(WEB_ADMIN_ACTOR, draft.id, {
          data,
          declaredMimeType: mime,
        });
        await f.service.setActive(WEB_ADMIN_ACTOR, draft.id, true);
        const [dto] = await publicBanners();
        assert.equal(dto!.titleUz, f.input.titleUz);
        assert.equal(dto!.href, null);
        assert.equal("storageKey" in dto!, false);
        assert.equal("targetCategoryId" in dto!, false);
        assert.equal(f.files.size, 1);
        await f.service.update(WEB_ADMIN_ACTOR, draft.id, {
          ...f.input,
          titleRu: "Обновлён",
          isActive: true,
        });
        assert.equal((await publicBanners())[0]!.titleRu, "Обновлён");
        await f.service.setActive(WEB_ADMIN_ACTOR, draft.id, false);
        assert.equal((await publicBanners()).length, 0);
        await f.service.delete(WEB_ADMIN_ACTOR, draft.id);
        assert.equal(f.files.size, 0);
        assert.equal(
          f.sqlite
            .prepare('SELECT count(*) n FROM "AuditLog" WHERE action = ?')
            .get("banner.activate")!.n,
          1,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("banner validation rejects unsafe URLs, mixed target fields, empty activation and malformed images", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      for (const targetUrl of [
        "javascript:alert(1)",
        "data:image/png,evil",
        "file:///x",
        "tg://x",
        "http://example.test",
        "https://user:pass@example.test",
      ])
        assert.throws(() =>
          parseBanner({ ...f.input, targetType: "URL", targetUrl }),
        );
      assert.throws(() =>
        parseBanner({ ...f.input, targetType: "NONE", targetProductId: "x" }),
      );
      assert.throws(() => parseBanner({ ...f.input, targetType: "CATEGORY" }));
      await assert.rejects(
        f.service.create(WEB_ADMIN_ACTOR, { ...f.input, isActive: true }),
      );
      const draft = await f.service.create(WEB_ADMIN_ACTOR, f.input);
      await assert.rejects(
        f.service.upload(WEB_ADMIN_ACTOR, draft.id, {
          data: Buffer.from("fake PNG"),
          declaredMimeType: "image/png",
        }),
      );
      assert.equal(f.files.size, 0);
    });
  } finally {
    f.sqlite.close();
  }
});
test("banner ID targets follow slug changes, missing targets are safe, public ordering is deterministic", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Cat','Cat','old-category',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','RU','UZ','old-product',100,'ACTIVE',1);`,
      );
      const targets = [
        { targetType: "NONE" },
        { targetType: "CATALOG" },
        { targetType: "CATEGORY", targetCategoryId: "c" },
        { targetType: "PRODUCT", targetProductId: "p" },
        { targetType: "URL", targetUrl: "https://example.test/collection" },
      ];
      for (const [i, target] of targets.entries()) {
        const b = await f.service.create(WEB_ADMIN_ACTOR, {
          ...f.input,
          ...target,
          sortOrder: i,
        });
        await f.service.upload(WEB_ADMIN_ACTOR, b.id, {
          data: png,
          declaredMimeType: "image/png",
        });
        await f.service.setActive(WEB_ADMIN_ACTOR, b.id, true);
      }
      f.sqlite.exec(
        `UPDATE Category SET slug='new-category' WHERE id='c'; UPDATE Product SET slug='new-product' WHERE id='p';`,
      );
      assert.deepEqual(
        (await publicBanners()).map((b) => b.href),
        [
          null,
          "/catalog",
          "/catalog?category=new-category",
          "/catalog/new-product",
          "https://example.test/collection",
        ],
      );
      f.sqlite.exec(
        `DELETE FROM Product WHERE id='p'; DELETE FROM Category WHERE id='c';`,
      );
      assert.equal((await publicBanners())[2]!.href, null);
      assert.equal((await publicBanners())[3]!.href, null);
      const rows = await publicBanners();
      assert.equal(rows.length, 5);
      assert.deepEqual(
        (await publicBanners()).map((b) => b.id),
        rows.map((b) => b.id),
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("banner replacement deletes old image only after persistence, DB failure compensates new image", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const b = await f.service.create(WEB_ADMIN_ACTOR, f.input);
      await f.service.upload(WEB_ADMIN_ACTOR, b.id, {
        data: png,
        declaredMimeType: "image/png",
      });
      const first = (await f.service.record(b.id)).storageKey!;
      await f.service.upload(WEB_ADMIN_ACTOR, b.id, {
        data: jpeg,
        declaredMimeType: "image/jpeg",
      });
      const current = (await f.service.record(b.id)).storageKey!;
      assert.equal(f.files.has(first), false);
      assert.equal(f.files.has(current), true);
      f.sqlite.exec(
        `CREATE TRIGGER fail_banner BEFORE UPDATE ON Banner BEGIN SELECT RAISE(ABORT, 'fixture persistence failure'); END;`,
      );
      await assert.rejects(
        f.service.upload(WEB_ADMIN_ACTOR, b.id, {
          data: webp,
          declaredMimeType: "image/webp",
        }),
      );
      assert.equal((await f.service.record(b.id)).storageKey, current);
      assert.equal(f.files.size, 1);
      assert.equal(f.files.has(current), true);
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual Worker: banners stay public with commerce off; marketing CRUD requires Admin session + CSRF", async () => {
  const f = await marketingRuntime("0");
  try {
    const publicResponse = await f.call(
      "/home/banners",
      "GET",
      undefined,
      {},
      "https://preview.invalid",
    );
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(await publicResponse.json(), { banners: [] });
    assert.equal((await f.call("/admin/marketing/banners")).status, 401);
    assert.equal(
      (
        await f.call(
          "/admin/marketing/banners",
          "POST",
          { titleRu: "RU", titleUz: "UZ" },
          { ...f.signed, "x-csrf-token": "wrong" },
        )
      ).status,
      403,
    );
    const created = await f.admin("/marketing/banners", "POST", {
      titleRu: "RU",
      titleUz: "UZ",
    });
    assert.equal(created.status, 200);
    const id = ((await created.json()) as { banner: { id: string } }).banner.id;
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "banner.png",
    );
    const uploaded = await f.admin(
      `/marketing/banners/${id}/images/upload`,
      "POST",
      form,
    );
    assert.equal(uploaded.status, 200, await uploaded.text());
    assert.equal(
      (await f.admin(`/marketing/banners/${id}/activate`, "POST")).status,
      200,
    );
    assert.equal(
      (await f.call("/checkout", "POST", {}, {}, "https://preview.invalid"))
        .status,
      503,
    );
    const response = await f.call(
      "/home/banners",
      "GET",
      undefined,
      {},
      "https://preview.invalid",
    );
    assert.equal(
      ((await response.json()) as { banners: unknown[] }).banners.length,
      1,
    );
    assert.equal(
      (await f.admin(`/marketing/banners/${id}`, "DELETE")).status,
      200,
    );
  } finally {
    await f.mf.dispose();
  }
});
