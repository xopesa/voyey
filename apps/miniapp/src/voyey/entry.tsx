// Separate Vite development HTML. Neither this entry nor its assets are production inputs.
if (
  import.meta.env.DEV &&
  ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
) {
  void import("./App").then(({ mountDemo }) => mountDemo());
} else {
  document.getElementById("root")!.textContent =
    "VOYEY UI-01 is available only in local development.";
}
