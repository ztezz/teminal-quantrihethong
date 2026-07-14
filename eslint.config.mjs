import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
    globalIgnores([".next/**", "out/**", "dist/**", "coverage/**", "next-env.d.ts"]),
    ...nextVitals,
    ...nextTypeScript,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
]);
