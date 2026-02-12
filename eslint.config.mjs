import obsidianmd from "eslint-plugin-obsidianmd";
import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                sourceType: "module",
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "obsidianmd": obsidianmd,
        },
        rules: {
            ...obsidianmd.configs.recommended,
            "obsidianmd/ui/sentence-case": ["error", { "brands": ["Folder Git", "Git", "GitHub", "PAT", "URL"], "allowAutoFix": true }],
            "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
            "no-console": "error",
        },
    },
    {
        ignores: ["main.js", "node_modules/**", "dist/**", "build/**", "*.js", "*.mjs"],
    }
];
