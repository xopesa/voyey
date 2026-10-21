// Test-only static preview. No API endpoints and no PostgreSQL writes.
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
  "useCart",
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
      name: "fixture-only-mocks",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(next\/(navigation|image|link))$|\/(api-client|auth-storage|TelegramBootstrap|useCart)$/,
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
const server = createServer((request, response) => {
  if (request.url === "/inter.woff2") {
    response.setHeader("Content-Type", "font/woff2");
    response.end(font);
  } else if (files.has(request.url)) {
    response.setHeader(
      "Content-Type",
      request.url.endsWith("css") ? "text/css" : "text/javascript",
    );
    response.end(files.get(request.url));
  } else if (/^\/photo-[123]\.svg$/.test(request.url)) {
    const shade = request.url.includes("2")
      ? "#dddfe1"
      : request.url.includes("3")
        ? "#767b80"
        : "#242427";
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750"><rect width="600" height="750" fill="#e9ebed"/><path d="M230 100Q300 30 370 100L395 175 515 270 445 405 392 365 392 655 208 655 208 365 155 405 85 270 205 175Z" fill="${shade}"/><path d="M230 100Q300 230 370 100M210 505Q300 460 390 505L370 580H230Z" fill="none" stroke="#8a8e93" stroke-width="6"/><path d="M275 175v100M325 175v100" stroke="#c6ff3d" stroke-width="5"/><text x="300" y="710" text-anchor="middle" font-family="Arial" font-size="20" fill="#62676d">TEST FIXTURE · ${request.url[7]}</text></svg>`,
    );
  } else if (request.url.includes("missing-image")) {
    response.statusCode = 404;
    response.end();
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  }
});
server.listen(3400, "127.0.0.1", () =>
  log("Isolated product fixture: http://127.0.0.1:3400 (no real cart writes)"),
);
