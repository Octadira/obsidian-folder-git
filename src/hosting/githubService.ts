import { requestUrl } from "obsidian";
import { apiErrorMessage } from "./apiError";
import type { HostingOrg, HostingRepo, HostingService, HostingUser } from "./hostingService";

const GITHUB_API = "https://api.github.com";

/**
 * GitHub REST API service.
 * Uses Obsidian's requestUrl (no external deps).
 * Token is ONLY sent via Authorization header — never in URLs or logs.
 */
export class GitHubService implements HostingService {
    readonly id = "github" as const;
    readonly gitHost = "github.com";
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    private headers(): Record<string, string> {
        return {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };
    }

    /** Validate token and return the authenticated user */
    async validateToken(): Promise<HostingUser> {
        const res = await requestUrl({
            url: `${GITHUB_API}/user`,
            headers: this.headers(),
            throw: false,
        });

        if (res.status !== 200) {
            throw new Error(apiErrorMessage(res, "GitHub"));
        }

        return res.json as HostingUser;
    }

    /** Check if a repo exists */
    async repoExists(owner: string, name: string): Promise<boolean> {
        try {
            const res = await requestUrl({
                url: `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
                headers: this.headers(),
                throw: false,
            });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Organizations the user belongs to.
     * Classic tokens need the `read:org` scope to see private memberships.
     * GitHub does not allow creating organizations through the REST API.
     */
    async listOrganizations(_username: string): Promise<HostingOrg[]> {
        const orgs: HostingOrg[] = [];
        for (let page = 1; page <= 10; page++) {
            const res = await requestUrl({
                url: `${GITHUB_API}/user/orgs?per_page=100&page=${page}`,
                headers: this.headers(),
                throw: false,
            });
            if (res.status !== 200) {
                throw new Error(apiErrorMessage(res, "GitHub"));
            }
            const batch = res.json as { login: string }[];
            orgs.push(...batch.map((o) => ({ name: o.login, canCreateRepo: true })));
            if (batch.length < 100) break;
        }
        return orgs;
    }

    /** Create a new repository for the authenticated user, or in an organization */
    async createRepo(
        name: string,
        isPrivate: boolean,
        description: string = "",
        owner?: string
    ): Promise<HostingRepo> {
        const url = owner
            ? `${GITHUB_API}/orgs/${encodeURIComponent(owner)}/repos`
            : `${GITHUB_API}/user/repos`;

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
            throw new Error(apiErrorMessage(res, "GitHub"));
        }

        return res.json as HostingRepo;
    }
}
