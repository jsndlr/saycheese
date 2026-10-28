import tseslint from "typescript-eslint";

const FORBIDDEN_FUNCTION_BUILDERS = ["query", "mutation", "action"];

export default tseslint.config(
  {
    ignores: ["convex/_generated/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/functions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_generated/server", "_generated/server"],
              importNames: FORBIDDEN_FUNCTION_BUILDERS,
              message:
                "Import public functions from ./functions instead: query/mutation/action bypass the auth and permission contract.",
            },
          ],
        },
      ],
    },
  },
);
