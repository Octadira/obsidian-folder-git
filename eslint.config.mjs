import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    {
        ignores: ["main.js", "node_modules/**", "dist/**", "build/**", "*.js", "*.mjs", "package.json", "package-lock.json"],
    },
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                sourceType: "module",
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                // Obsidian globals
                activeWindow: "readonly",
                activeDocument: "readonly",
            },
        },
        rules: {
            "obsidianmd/ui/sentence-case": ["error", {
                brands: ["Folder Git", "Git", "GitHub", "Forgejo", "Gitea", "Codeberg", "PAT", "URL", "HTTPS", "SSH", "Obsidian"],
                allowAutoFix: true,
            }],
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "no-console": "error",
        },
    },
]);
