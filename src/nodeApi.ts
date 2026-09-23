import * as nodeFs from "fs";
import * as nodeProcess from "process";

/**
 * Minimal, explicitly typed view of the Node APIs this plugin uses.
 * Keeps every call site type-safe even where Node typings are unavailable.
 */
export interface FsApi {
    existsSync(path: string): boolean;
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding: "utf8"): string;
    writeFileSync(path: string, data: string): void;
    unlinkSync(path: string): void;
}

export const fs = nodeFs as unknown as FsApi;

type EnvMap = Record<string, string | undefined>;

const proc = nodeProcess as unknown as { env?: EnvMap };

/** Copy of the current process environment (used as the base env for git child processes) */
export function processEnv(): EnvMap {
    return { ...(proc.env ?? {}) };
}
