import { requestUrl } from "obsidian";

const GITHUB_API = "https://api.github.com";

export interface GitHubUser {
    login: string;
    name: string | null;
    avatar_url: string;
}

export interface GitHubRepo {
    full_name: string;
    html_url: string;
    clone_url: string;
    ssh_url: string;
    private: boolean;
}

/**
 * GitHub REST API service.
 * Uses Obsidian's requestUrl (no external deps).
 * Token is ONLY sent via Authorization header — never in URLs or logs.
 */
export class GitHubService {
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
    async validateToken(): Promise<GitHubUser> {
        const res = await requestUrl({
            url: `${GITHUB_API}/user`,
            headers: this.headers(),
        });

        if (res.status !== 200) {
            throw new Error("Invalid GitHub token");
        }

        return res.json as GitHubUser;
    }

    /** Get authenticated username */
    async getUsername(): Promise<string> {
        const user = await this.validateToken();
        return user.login;
    }

    /** Check if a repo exists for the authenticated user */
    async repoExists(owner: string, name: string): Promise<boolean> {
        try {
            const res = await requestUrl({
                url: `${GITHUB_API}/repos/${owner}/${name}`,
                headers: this.headers(),
                throw: false,
            });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    /** Create a new repository for the authenticated user */
    async createRepo(
        name: string,
        isPrivate: boolean,
        description: string = ""
    ): Promise<GitHubRepo> {
        const res = await requestUrl({
            url: `${GITHUB_API}/user/repos`,
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
        });

        if (res.status !== 201) {
            const body = res.json;
            const msg = body?.message || `GitHub API error (${res.status})`;
            throw new Error(msg);
        }

        return res.json as GitHubRepo;
    }
}
