import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "packages/broker-toss/src/generated/**",
      "prototype/**",
    ],
  },
  eslint.configs.recommended,
  ...nextVitals,
  {
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["apps/web/src/app/**/*.{ts,tsx}", "apps/web/src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "@portfolio-rebalancer/application",
            "@portfolio-rebalancer/broker",
            "@portfolio-rebalancer/broker-toss",
            "@portfolio-rebalancer/domain",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/app/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "@portfolio-rebalancer/application",
            "@portfolio-rebalancer/broker",
            "@portfolio-rebalancer/broker-toss",
            "@portfolio-rebalancer/contracts",
            "@portfolio-rebalancer/domain",
            "next",
          ],
          patterns: ["next/*"],
        },
      ],
    },
  },
);
