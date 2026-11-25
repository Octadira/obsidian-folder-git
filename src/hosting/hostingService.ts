import type { PluginSettings } from "../types";
import { GitHubService } from "./githubService";
import { ForgejoService } from "./forgejoService";

export type HostingProviderId = "github" | "forgejo";

export const HOSTING_PROVIDER_LABELS: Record<HostingProviderId, string> = {
    github: "GitHub",
    forgejo: "Forgejo",
};

export interface HostingUser {
    login: string;
}

export interface HostingRepo {
    full_name: string;
    html_url: string;
    clone_url: string;
    ssh_url: string;
    private: boolean;
}

export interface HostingOrg {
    /** Organization login/handle used in URLs and API paths */
    name: string;
    /** Whether the authenticated user may create repositories in it */
    canCreateRepo: boolean;
}

export type OrgVisibility = "public" | "limited" | "private";

/**
 * Common interface for Git hosting providers (GitHub, Forgejo/Gitea).
 * Implementations use Obsidian's requestUrl and only send the token via headers.
 */
export interface HostingService {
    readonly id: HostingProviderId;
    /** Host (hostname[:port]) that Git remotes point to, used to match credentials */
    readonly gitHost: string;
    validateToken(): Promise<HostingUser>;
    repoExists(owner: string, name: string): Promise<boolean>;
    /** Create a repo for the user, or inside `owner` when it is an organization */
    createRepo(name: string, isPrivate: boolean, description?: string, owner?: string): Promise<HostingRepo>;
    /** Organizations the authenticated user belongs to */
    listOrganizations(username: string): Promise<HostingOrg[]>;
    /** Create a new organization owned by the user (not supported by every provider) */
    createOrganization?(name: string, visibility: OrgVisibility): Promise<HostingOrg>;
}

/** Credentials usable for HTTPS Git operations against a host */
export interface HostingAccount {
    id: HostingProviderId;
    gitHost: string;
    username: string;
    token: string;
    /** Whether the token may be sent to plain http:// remotes (only for an http:// Forgejo instance) */
    allowHttp: boolean;
}

/** Whether a hostname refers to localhost or a private/LAN network address */
export function isLocalHost(hostname: string): boolean {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Normalize a user-entered Forgejo instance URL:
 * trims, removes trailing slashes and a trailing "/api/v1".
 * Enforces HTTPS except for local or private-network instances.
 */
export function normalizeInstanceUrl(input: string): string {
    let value = input.trim().replace(/\/+$/, "");
    value = value.replace(/\/api\/v1$/i, "");
    if (!value) return "";
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Instance URL must start with https:// or http://");
    }
    if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
        throw new Error("Plain http:// is only allowed for local or private-network instances. Use https:// instead.");
    }
    return value;
}

/** Scheme and "host[:port]" of an http(s) remote URL, or null for SSH/other remotes */
export function httpRemoteHost(remoteUrl: string): { protocol: "https" | "http"; secure: boolean; host: string } | null {
    if (!/^https?:\/\//i.test(remoteUrl)) return null;
    try {
        const url = new URL(remoteUrl);
        const secure = url.protocol === "https:";
        return { protocol: secure ? "https" : "http", secure, host: url.host.toLowerCase() };
    } catch {
        return null;
    }
}

/** Build a hosting service for a provider, or null if it is not configured */
export function createHostingService(settings: PluginSettings, id: HostingProviderId): HostingService | null {
    if (id === "github") {
        return settings.githubToken ? new GitHubService(settings.githubToken) : null;
    }
    if (!settings.forgejoToken || !settings.forgejoUrl) return null;
    try {
        return new ForgejoService(normalizeInstanceUrl(settings.forgejoUrl), settings.forgejoToken);
    } catch {
        return null;
    }
}

/** Providers that have a validated account (token + username) */
export function getConfiguredAccounts(settings: PluginSettings): HostingAccount[] {
    const accounts: HostingAccount[] = [];
    if (settings.githubToken && settings.githubUsername) {
        accounts.push({
            id: "github",
            gitHost: "github.com",
            username: settings.githubUsername,
            token: settings.githubToken,
            allowHttp: false,
        });
    }
    if (settings.forgejoToken && settings.forgejoUsername && settings.forgejoUrl) {
        try {
            const url = new URL(normalizeInstanceUrl(settings.forgejoUrl));
            accounts.push({
                id: "forgejo",
                gitHost: url.host.toLowerCase(),
                username: settings.forgejoUsername,
                token: settings.forgejoToken,
                // The user already chose (and was warned about) an http:// instance
                allowHttp: url.protocol === "http:",
            });
        } catch {
            // Invalid instance URL — ignore
        }
    }
    return accounts;
}

/**
 * Find the account whose host matches an http(s) remote URL.
 * Tokens are never offered to plain http:// remotes, except for an http:// Forgejo instance.
 */
export function findAccountForRemote(settings: PluginSettings, remoteUrl: string): HostingAccount | null {
    const remote = httpRemoteHost(remoteUrl);
    if (!remote) return null;
    return (
        getConfiguredAccounts(settings).find(
            (a) => a.gitHost === remote.host && (remote.secure || a.allowHttp)
        ) ?? null
    );
}
