const { isAbsolute, join } = require("node:path");

const root = process.env.STENZO_ROOT;
if (!root || !isAbsolute(root))
  throw new Error("STENZO_ROOT must be an absolute monorepo path");

require(join(root, "deploy", "turon", "launcher.cjs")).start("miniapp", root);
