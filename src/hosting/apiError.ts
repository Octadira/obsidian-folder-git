import type { RequestUrlResponse } from "obsidian";

/** Extract an API error message from a response, falling back to the status code */
export function apiErrorMessage(res: RequestUrlResponse, provider: string): string {
    try {
        const body = res.json as { message?: string } | null;
        if (body?.message) return `${provider}: ${body.message}`;
    } catch {
        // Non-JSON body
    }
    if (res.status === 401) return `${provider}: invalid or expired token`;
    if (res.status === 403) return `${provider}: token lacks the required permissions`;
    return `${provider} API error (${res.status})`;
}
