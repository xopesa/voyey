import config from "../../eslint.config.mjs";
import globals from "globals";
export default [
  ...config,
  { ignores: ["next-env.d.ts"] },
  {
    files: ["tests/*.test.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
