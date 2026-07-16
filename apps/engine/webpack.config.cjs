const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "../..");

const workspaceAliases = {
  "@portfolio-rebalancer/broker": path.join(workspaceRoot, "packages/broker/src/index.ts"),
  "@portfolio-rebalancer/broker-toss": path.join(
    workspaceRoot,
    "packages/broker-toss/src/index.ts",
  ),
  "@portfolio-rebalancer/contracts": path.join(workspaceRoot, "packages/contracts/src/index.ts"),
  "@portfolio-rebalancer/database": path.join(workspaceRoot, "packages/database/src/index.ts"),
  "@portfolio-rebalancer/domain": path.join(workspaceRoot, "packages/domain/src/index.ts"),
};

module.exports = (options) => ({
  ...options,
  externals: [
    ({ request }, callback) => {
      if (
        !request ||
        request.startsWith(".") ||
        path.isAbsolute(request) ||
        Object.hasOwn(workspaceAliases, request)
      ) {
        callback();
        return;
      }
      callback(null, `commonjs ${request}`);
    },
  ],
  output: {
    ...options.output,
    filename: "main.cjs",
    libraryTarget: "commonjs2",
  },
  resolve: {
    ...options.resolve,
    alias: {
      ...options.resolve?.alias,
      ...workspaceAliases,
    },
  },
});
