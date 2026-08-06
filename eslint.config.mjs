import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  // Fichiers .ts serveur : `usePersistentStorage` / `useRedisCache` ne sont pas des React Hooks.
  // Les vrais hooks React restent contrôlés dans les .tsx.
  {
    files: ["**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default eslintConfig;
