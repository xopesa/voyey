// Isolated static fixture, with no API endpoints or database writes.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { log } from "node:console";
const directory = dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(
  resolve(directory, "../../../../api/package.json"),
);
const esbuild = createRequire(apiRequire.resolve("tsx/package.json"))(
  "esbuild",
);
const modules = [
  "next/navigation",
  "next/image",
  "next/link",
  "api-client",
  "auth-storage",
  "TelegramBootstrap",
];
const build = await esbuild.build({
  entryPoints: [resolve(directory, "entry.jsx")],
  bundle: true,
  write: false,
  outdir: directory,
  jsx: "automatic",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "orders-fixture-mocks",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(next\/(navigation|image|link))$|\/(api-client|auth-storage|TelegramBootstrap)$/,
          },
          (args) => {
            const name = modules.find(
              (value) => args.path === value || args.path.endsWith(`/${value}`),
            );
            return name ? { path: name, namespace: "fixture" } : undefined;
          },
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          resolveDir: directory,
          contents:
            args.path === "next/link"
              ? 'export { Link as default } from "./mocks.jsx";'
              : args.path === "next/image"
                ? 'export { default } from "./mocks.jsx";'
                : 'export * from "./mocks.jsx";',
          loader: "jsx",
        }));
      },
    },
  ],
});
const files = new Map(
  build.outputFiles.map((file) => [
    file.path.endsWith(".css") ? "/entry.css" : "/entry.js",
    file.contents,
  ]),
);
const font = readFileSync(
  resolve(directory, "../../../src/fonts/InterVariable.woff2"),
);
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/entry.css"><style>@font-face{font-family:Inter;src:url('/inter.woff2')}html{--font-inter:Inter}.fixture-toolbar{height:110px;padding:8px;font:11px Arial;background:#fff;color:#111;overflow:auto}.fixture-toolbar button,.fixture-toolbar select{font:11px Arial;margin:2px;min-height:24px}.fixture-toolbar output{display:block;overflow-wrap:anywhere}.app-shell{--app-viewport-height:calc(100dvh - 110px)}.app-shell__session{font-size:10px}</style></head><body><div id="root"></div><script src="/entry.js"></script></body></html>`;
createServer((request, response) => {
  if (request.url === "/inter.woff2") {
    response.setHeader("Content-Type", "font/woff2");
    response.end(font);
  } else if (files.has(request.url)) {
    response.setHeader(
      "Content-Type",
      request.url.endsWith("css") ? "text/css" : "text/javascript",
    );
    response.end(files.get(request.url));
  } else if (request.url === "/fixture-photo.svg") {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="375" viewBox="0 0 300 375"><rect width="300" height="375" fill="#e9ebed"/><path d="M115 50Q150 15 185 50L198 88 258 135 223 203 196 183 196 328 104 328 104 183 78 203 43 135 103 88Z" fill="#242427"/><path d="M115 50Q150 115 185 50M105 253Q150 230 195 253L185 290H115Z" fill="none" stroke="#8a8e93" stroke-width="3"/><path d="M137 87v50M163 87v50" stroke="#c6ff3d" stroke-width="3"/><text x="150" y="355" text-anchor="middle" font-family="Arial" font-size="12" fill="#62676d">TEST FIXTURE</text></svg>',
    );
  } else if (request.url.includes("missing-image")) {
    response.statusCode = 404;
    response.end();
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  }
}).listen(3404, "127.0.0.1", () =>
  log(
    "Isolated orders fixture: http://127.0.0.1:3404 (no real orders or payments or database writes)",
  ),
);
