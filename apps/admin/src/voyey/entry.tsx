/// <reference types="vite/client" />
if (
  import.meta.env.DEV &&
  ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
) {
  void import("./App").then(({ mountDemo }) => mountDemo());
} else {
  document.getElementById("root")!.textContent =
    "VOYEY Admin demo is available only in local development.";
}
