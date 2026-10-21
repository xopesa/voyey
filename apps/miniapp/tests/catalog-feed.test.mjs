import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const { AbortController, setTimeout, clearTimeout } = globalThis;
const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../src/lib/catalog-feed.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports, AbortController, setTimeout, clearTimeout },
);
const { CatalogFeed } = exports;
// These minimal records test the feed only; they never enter the production API.
const item = (id) => ({ id });
const result = (ids, nextCursor = null) => ({
  products: ids.map(item),
  nextCursor,
});
const ids = (feed) =>
  Array.from(feed.snapshot().products, (product) => product.id);

test("filters and page size reach the loader; pagination preserves filters and merges by id", async () => {
  const calls = [];
  const feed = new CatalogFeed(
    { search: "Худи & hudi", category: "hoodies", limit: 12 },
    async (query) => {
      calls.push({ ...query });
      return query.cursor ? result(["b", "c"]) : result(["a", "b"], "cursor-b");
    },
  );
  await feed.start();
  assert.deepEqual(ids(feed), ["a", "b"]);
  await feed.more();
  assert.deepEqual(calls[1], {
    search: "Худи & hudi",
    category: "hoodies",
    limit: 12,
    cursor: "cursor-b",
  });
  assert.deepEqual(ids(feed), ["a", "b", "c"]);
  assert.equal(feed.snapshot().nextCursor, null);
  await feed.more();
  assert.equal(calls.length, 2);
});

test("empty first page remains a successful empty state", async () => {
  const feed = new CatalogFeed({}, async () => result([]));
  await feed.start();
  assert.equal(feed.snapshot().status, "success");
  assert.equal(feed.snapshot().products.length, 0);
});

test("next-page errors preserve products and cursor and support a retry", async () => {
  let failures = 1;
  const feed = new CatalogFeed({}, async (query) => {
    if (!query.cursor) return result(["a"], "cursor-a");
    if (failures--) throw new Error("Unavailable test loader");
    return result(["b"]);
  });
  await feed.start();
  await feed.more();
  assert.deepEqual(ids(feed), ["a"]);
  assert.equal(feed.snapshot().moreError, true);
  assert.equal(feed.snapshot().nextCursor, "cursor-a");
  await feed.more();
  assert.deepEqual(ids(feed), ["a", "b"]);
  assert.equal(feed.snapshot().moreError, false);
});

test("changing filters cancels stale requests and clears pagination", async () => {
  let resolveOld;
  let oldSignal;
  const oldFeed = new CatalogFeed({ category: "old" }, (_query, signal) => {
    oldSignal = signal;
    return new Promise((resolve) => {
      resolveOld = resolve;
    });
  });
  const oldRequest = oldFeed.start();
  oldFeed.cancel();
  const newFeed = new CatalogFeed({ category: "new" }, async (query) => {
    assert.equal(query.cursor, undefined);
    return result([]);
  });
  await newFeed.start();
  resolveOld(result(["old-item"], "old-cursor"));
  await oldRequest;
  assert.equal(oldSignal.aborted, true);
  assert.deepEqual(ids(oldFeed), []);
  assert.deepEqual(ids(newFeed), []);
  assert.equal(newFeed.snapshot().nextCursor, null);
});

test("concurrent pagination calls are ignored and a repeated cursor is an error", async () => {
  let resolveNext;
  let pageCalls = 0;
  const feed = new CatalogFeed({}, async (query) => {
    if (!query.cursor) return result(["a"], "same-cursor");
    pageCalls++;
    return new Promise((resolve) => {
      resolveNext = resolve;
    });
  });
  await feed.start();
  const pending = feed.more();
  await feed.more();
  assert.equal(pageCalls, 1);
  assert.equal(feed.snapshot().loadingMore, true);
  resolveNext(result(["b"], "same-cursor"));
  await pending;
  assert.deepEqual(ids(feed), ["a"]);
  assert.equal(feed.snapshot().moreError, true);
});

test("timeout produces an error state and a subsequent first-page retry succeeds", async () => {
  let first = true;
  const feed = new CatalogFeed(
    {},
    (_query, signal) => {
      if (!first) return Promise.resolve(result([]));
      first = false;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Aborted")), {
          once: true,
        }),
      );
    },
    10,
  );
  await feed.start();
  assert.equal(feed.snapshot().status, "error");
  await feed.start();
  assert.equal(feed.snapshot().status, "success");
});
