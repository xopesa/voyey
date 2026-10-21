import sharedConfig from "../../eslint.config.mjs";

export default [
  ...sharedConfig,
  // Next.js regenerates this declaration file during dev/build.
  { ignores: ["next-env.d.ts"] },
];
