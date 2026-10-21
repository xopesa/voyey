import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import ts from "typescript";
const require = createRequire(import.meta.url);
function nodes(n) {
  return n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
}
function fixture(locale = "ru", data = [], status = "success") {
  const exports = {},
    selected = [],
    scrolled = [],
    refs = {
      current: {
        children: [
          {
            getBoundingClientRect: () => ({ left: -100 }),
            scrollIntoView: (o) => scrolled.push([0, o]),
          },
          {
            getBoundingClientRect: () => ({ left: 1 }),
            scrollIntoView: (o) => scrolled.push([1, o]),
          },
        ],
        getBoundingClientRect: () => ({ left: 0 }),
      },
    };
  const Hero = () => null,
    Link = () => null;
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(
          "../src/components/home/HomeBannerCarousel.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      window: { matchMedia: () => ({ matches: false }) },
      require: (name) =>
        ({
          react: {
            useState: () => [0, (v) => selected.push(v)],
            useRef: () => refs,
          },
          "next/link": { default: Link },
          "../PreferencesProvider": {
            usePreferences: () => ({
              t: (k) => k,
              localizedText: (v) => v[locale],
            }),
          },
          "./HomeHero": { HomeHero: Hero },
          "../../lib/api-client": { getHomeBanners: () => {} },
          "./useCatalogResource": {
            useCatalogResource: () => ({ state: { status, data } }),
          },
        })[name] ?? (name.endsWith(".css") ? {} : require(name)),
    },
  );
  return { ...exports, Hero, Link, selected, scrolled };
}
const banner = {
  id: "fixture",
  titleRu: "Новая коллекция",
  titleUz: "Yangi kolleksiya",
  subtitleRu: "Только для теста",
  subtitleUz: "Sinov",
  buttonRu: "Смотреть",
  buttonUz: "Ko‘rish",
  imageUrl: "https://fixture.invalid/banner.png",
  href: "/catalog",
};
for (const state of ["loading", "error", "success"])
  test(`banners ${state} without active records retains original HomeHero`, () => {
    const f = fixture("ru", [], state);
    assert.equal(f.HomeBannerCarousel().type, f.Hero);
  });
for (const locale of ["ru", "uz"])
  test(`banner ${locale}: localized title and CTA, full-card navigation, no dots for one banner`, () => {
    const f = fixture(locale);
    const tree = nodes(f.BannerCarousel({ banners: [banner] }));
    assert.ok(
      tree.some(
        (n) =>
          n.type === "h2" &&
          n.props.children === banner[locale === "ru" ? "titleRu" : "titleUz"],
      ),
    );
    assert.ok(
      tree.some((n) => n.type === f.Link && n.props.href === "/catalog"),
    );
    assert.equal(tree.filter((n) => n.type === "button").length, 0);
  });
test("multi banner scrolling selects the nearest slide; dots navigate without autoplay", () => {
  const f = fixture();
  const tree = nodes(
    f.BannerCarousel({
      banners: [
        banner,
        { ...banner, id: "second", href: "https://example.test" },
      ],
    }),
  );
  tree
    .find((n) => n.props?.className === "home-banners__rail")
    .props.onScroll();
  assert.deepEqual(f.selected, [1]);
  const dots = tree.filter((n) => n.type === "button");
  assert.equal(dots.length, 2);
  dots[1].props.onClick();
  assert.equal(f.scrolled[0][0], 1);
  assert.equal(f.scrolled[0][1].inline, "start");
  const external = tree.find((n) => n.type === "a");
  assert.equal(external.props.target, "_blank");
  assert.equal(external.props.rel, "noopener noreferrer");
});
test("NONE is not clickable and unsafe hrefs do not become links", () => {
  for (const href of [null, "javascript:alert(1)", "//evil.invalid"]) {
    const f = fixture();
    const tree = nodes(f.BannerCarousel({ banners: [{ ...banner, href }] }));
    assert.equal(
      tree.filter((n) => n.type === "a" || n.type === f.Link).length,
      0,
    );
  }
});
