import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Next.js 16 ships eslint-plugin-react-hooks@7 with React Compiler rules.
 * Several of those (refs during render, setState-in-effect, manual memo
 * preservation) fire on established patterns we still want (chart paint
 * hold, mount guards, data-load effects). Keep core-web-vitals + TS rules;
 * re-enable compiler rules later when we intentionally adopt them.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "import/no-anonymous-default-export": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "data/**",
    "scripts/**",
    ".trunk/**",
  ]),
]);

export default eslintConfig;
