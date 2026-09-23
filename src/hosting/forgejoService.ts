import { requestUrl } from "obsidian";
import { apiErrorMessage } from "./apiError";
import type { HostingOrg, HostingRepo, HostingService, HostingUser, OrgVisibility } from "./hostingService";

interface ForgejoOrg {
    /** Current field name for the org handle */
    name?: string;
    /** Deprecated alias still returned by older versions */
    username?: string;
}

const PAGE_SIZE = 50;

/**
 * Forgejo REST API service (also compatible with Gitea, which shares the API).
 * Works with any self-hosted instance or Codeberg.
 * Token is ONLY sent via Authorization header — never in URLs or logs.
 */
export class ForgejoService implements HostingService {
    readonly id = "forgejo" as const;
    readonly gitHost: string;
    private baseUrl: string;
    private token: string;

    /** @param baseUrl Normalized instance URL, e.g. "https://codeberg.org" (no trailing slash) */
    constructor(baseUrl: string, token: string) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.gitHost = new URL(baseUrl).host.toLowerCase();
    }

    private get api(): string {
        return `${this.baseUrl}/api/v1`;
    }

    private headers(): Record<string, string> {
        return {
            Authorization: `token ${this.token}`,
            Accept: "application/json",
        };
    }

    /** Validate token and return the authenticated user */
    async validateToken(): Promise<HostingUser> {
        const res = await requestUrl({
            url: `${this.api}/user`,
            headers: this.headers(),
            throw: false,
        });

        if (res.status !== 200) {
            throw new Error(apiErrorMessage(res, "Forgejo"));
        }

        return res.json as HostingUser;
    }

    /** Check if a repo exists */
    async repoExists(owner: string, name: string): Promise<boolean> {
        try {
            const res = await requestUrl({
                url: `${this.api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
                headers: this.headers(),
                throw: false,
            });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Organizations the user belongs to, with whether they may create repos there.
     * Requires the token's `organization` scope (read).
     */
    async listOrganizations(username: string): Promise<HostingOrg[]> {
        const names: string[] = [];
        for (let page = 1; page <= 20; page++) {
            const res = await requestUrl({
                url: `${this.api}/user/orgs?limit=${PAGE_SIZE}&page=${page}`,
                headers: this.headers(),
                throw: false,
            });
            if (res.status !== 200) {
                throw new Error(apiErrorMessage(res, "Forgejo"));
            }
            const batch = res.json as ForgejoOrg[];
            for (const org of batch) {
                const name = org.name || org.username;
                if (name) names.push(name);
            }
            if (batch.length < PAGE_SIZE) break;
        }

        return Promise.all(names.map(async (name) => ({
            name,
            canCreateRepo: await this.canCreateRepoIn(username, name),
        })));
    }

    /** Check org permissions; assume allowed if the check itself is unavailable */
    private async canCreateRepoIn(username: string, org: string): Promise<boolean> {
        if (!username) return true;
        try {
            const res = await requestUrl({
                url: `${this.api}/users/${encodeURIComponent(username)}/orgs/${encodeURIComponent(org)}/permissions`,
                headers: this.headers(),
                throw: false,
            });
            if (res.status !== 200) return true;
            const perms = res.json as { can_create_repository?: boolean; is_owner?: boolean; is_admin?: boolean };
            return !!(perms.can_create_repository || perms.is_owner || perms.is_admin);
        } catch {
            return true;
        }
    }

    /** Create a new organization owned by the authenticated user */
    async createOrganization(name: string, visibility: OrgVisibility): Promise<HostingOrg> {
        const res = await requestUrl({
            url: `${this.api}/orgs`,
            method: "POST",
            headers: {
                ...this.headers(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ username: name, visibility }),
            throw: false,
        });

        if (res.status !== 201) {
            throw new Error(apiErrorMessage(res, "Forgejo"));
        }

        const org = res.json as ForgejoOrg;
        return { name: org.name || org.username || name, canCreateRepo: true };
    }

    /** Create a new repository for the authenticated user, or in an organization */
    async createRepo(
        name: string,
        isPrivate: boolean,
        description: string = "",
        owner?: string
    ): Promise<HostingRepo> {
        const url = owner
            ? `${this.api}/orgs/${encodeURIComponent(owner)}/repos`
            : `${this.api}/user/repos`;

        const res = await requestUrl({
            url,
            method: "POST",
            headers: {
                ...this.headers(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name,
                description,
                private: isPrivate,
                auto_init: false,
            }),
            throw: false,
        });

        if (res.status !== 201) {
            throw new Error(apiErrorMessage(res, "Forgejo"));
        }

        return res.json as HostingRepo;
    }
}
