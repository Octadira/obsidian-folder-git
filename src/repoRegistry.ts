import simpleGit from "simple-git";
import { FileSystemAdapter, Notice } from "obsidian";
import * as fs from "fs";
import type {
    FolderRepoConfig,
    RepoInstance,
    RepoStatus,
    FileStatusResult,
    FileChangeType,
    GitLogEntry,
    FolderGitPluginInterface,
} from "./types";

/**
 * RepoRegistry: manages N SimpleGit instances, one per configured folder.
 */
export class RepoRegistry {
    private repos: Map<string, RepoInstance> = new Map();
    private plugin: FolderGitPluginInterface;

    constructor(plugin: FolderGitPluginInterface) {
        this.plugin = plugin;
    }

    /** Vault base path on disk */
    private get vaultBasePath(): string {
        return (this.plugin.app.vault.adapter as FileSystemAdapter).getBasePath();
    }

    /** Resolve a vault-relative folder path to an absolute path */
    private resolveAbsolutePath(folderPath: string): string {
        if (folderPath === "" || folderPath === "/") return this.vaultBasePath;
        return `${this.vaultBasePath}/${folderPath}`;
    }

    /** Get the git binary configuration */
    private get gitBinary(): string | undefined {
        return this.plugin.settings.gitBinaryPath || undefined;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    /** Initialize all configured repos on plugin load */
    async initialize(): Promise<void> {
        for (const config of this.plugin.settings.repos) {
            try {
                await this.addRepo(config);
            } catch (e) {
                console.error(`Folder Git: Failed to init repo for ${config.folderPath}:`, e);
                new Notice(`Folder Git: Failed to initialize repo for "${config.folderPath}"`);
            }
        }
    }

    /** Clean up all repos (timers, etc.) on plugin unload */
    destroy(): void {
        for (const [, instance] of this.repos) {
            if (instance.autoCommitTimer) {
                clearInterval(instance.autoCommitTimer);
            }
        }
        this.repos.clear();
    }

    // ─── Repo Management ───────────────────────────────────────────────────

    /** Add and initialize a repo for a folder */
    async addRepo(config: FolderRepoConfig): Promise<void> {
        const absolutePath = this.resolveAbsolutePath(config.folderPath);

        const git = simpleGit({
            baseDir: absolutePath,
            binary: this.gitBinary,
            config: ["core.quotepath=off"],
        });

        // Verify this is actually a git repo
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            throw new Error(`"${config.folderPath}" is not a Git repository`);
        }

        const instance: RepoInstance = {
            config,
            git,
            absolutePath,
        };

        // Set up auto-commit timer if configured
        if (config.autoCommitInterval > 0) {
            instance.autoCommitTimer = setInterval(
                () => { void this.autoCommit(config.folderPath); },
                config.autoCommitInterval * 60 * 1000
            );
        }

        this.repos.set(config.folderPath, instance);
    }

    /** Remove a repo from tracking (does NOT delete the .git folder) */
    removeRepo(folderPath: string): void {
        const instance = this.repos.get(folderPath);
        if (instance?.autoCommitTimer) {
            clearInterval(instance.autoCommitTimer);
        }
        this.repos.delete(folderPath);
    }

    /** Get a repo instance by folder path */
    getRepo(folderPath: string): RepoInstance | undefined {
        return this.repos.get(folderPath);
    }

    /** Get all active repo instances */
    getAllRepos(): RepoInstance[] {
        return Array.from(this.repos.values());
    }

    /** Get all configured folder paths */
    getAllPaths(): string[] {
        return Array.from(this.repos.keys());
    }

    /** Find which repo "owns" a file by vault-relative path */
    getRepoForFile(filePath: string): RepoInstance | undefined {
        let bestMatch: RepoInstance | undefined;
        let bestLength = -1;

        for (const [folder, instance] of this.repos) {
            if (
                (filePath.startsWith(folder + "/") || folder === "" || folder === filePath) &&
                folder.length > bestLength
            ) {
                bestMatch = instance;
                bestLength = folder.length;
            }
        }
        return bestMatch;
    }

    // ─── Git Operations ────────────────────────────────────────────────────

    /** Get full status for a repo */
    async getStatus(folderPath: string): Promise<RepoStatus> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo configured for "${folderPath}"`);

        const status = await instance.git.status();

        const staged: FileStatusResult[] = [];
        const changed: FileStatusResult[] = [];
        const untracked: string[] = [];
        const conflicted: string[] = [];

        for (const file of status.files) {
            const vaultPath = folderPath ? `${folderPath}/${file.path}` : file.path;

            if (file.working_dir === "?" && file.index === "?") {
                untracked.push(vaultPath);
                continue;
            }

            // Conflicted
            if (file.working_dir === "U" || file.index === "U") {
                conflicted.push(vaultPath);
                continue;
            }

            // Staged (index changes)
            if (file.index && file.index !== " " && file.index !== "?") {
                staged.push({
                    path: file.path,
                    vaultPath,
                    indexStatus: file.index,
                    workingTreeStatus: file.working_dir,
                    displayStatus: this.mapStatus(file.index),
                });
            }

            // Working tree changes
            if (file.working_dir && file.working_dir !== " " && file.working_dir !== "?") {
                changed.push({
                    path: file.path,
                    vaultPath,
                    indexStatus: file.index,
                    workingTreeStatus: file.working_dir,
                    displayStatus: this.mapStatus(file.working_dir),
                });
            }
        }

        return {
            folderPath,
            branch: status.current || "HEAD",
            staged,
            changed,
            untracked,
            conflicted,
            ahead: status.ahead,
            behind: status.behind,
        };
    }

    /** Stage files in a repo */
    async stage(folderPath: string, files: string[]): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.add(files);
    }

    /** Stage all files in a repo */
    async stageAll(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.add(".");
    }

    /** Unstage files in a repo */
    async unstage(folderPath: string, files: string[]): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.reset(["HEAD", "--", ...files]);
    }

    /** Unstage all files in a repo */
    async unstageAll(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.reset(["HEAD"]);
    }

    /** Discard changes for a file (checkout from HEAD) */
    async discard(folderPath: string, file: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.checkout(["--", file]);
    }

    /** Commit staged changes */
    async commit(folderPath: string, message: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.commit(message);
    }


    /** Get diff for a specific file (working tree vs HEAD) */
    async getDiff(folderPath: string, file: string, staged: boolean = false): Promise<string> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        const args = staged ? ["--cached", "--", file] : ["--", file];
        return await instance.git.diff(args);
    }

    /** Get commit log */
    async getLog(folderPath: string, limit: number = 50): Promise<GitLogEntry[]> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        const log = await instance.git.log({
            maxCount: limit,
            "--stat": null,
        });

        interface DiffLogEntry {
            hash: string;
            date: string;
            message: string;
            author_name: string;
            author_email: string;
            diff?: {
                files: { file: string }[];
            };
        }

        return log.all.map((entry) => {
            const diffEntry = entry as unknown as DiffLogEntry;
            return {
                hash: diffEntry.hash,
                hashShort: diffEntry.hash.substring(0, 7),
                message: diffEntry.message,
                author: diffEntry.author_name,
                date: diffEntry.date,
                files: diffEntry.diff?.files?.map((f) => f.file) || [],
            };
        });
    }

    /** Get current branch name */
    async getBranch(folderPath: string): Promise<string> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        const status = await instance.git.status();
        return status.current || "HEAD";
    }

    /** Get all branches */
    async getBranches(folderPath: string): Promise<{ current: string; all: string[] }> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        const branches = await instance.git.branchLocal();
        return {
            current: branches.current,
            all: branches.all,
        };
    }

    /** Checkout a branch */
    async checkout(folderPath: string, branch: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.checkout(branch);
    }

    /** Init a new git repo in a folder */
    async initRepo(absolutePath: string): Promise<void> {
        const git = simpleGit({
            baseDir: absolutePath,
            binary: this.gitBinary,
        });
        await git.init();
    }

    /** Clone a repo into a folder */
    async cloneRepo(url: string, absolutePath: string): Promise<void> {
        const git = simpleGit({
            binary: this.gitBinary,
        });
        await git.clone(url, absolutePath);
    }

    /** Add a remote to an existing repo */
    async addRemote(folderPath: string, name: string, url: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);
        await instance.git.addRemote(name, url);
    }

    // ─── GitHub Integration ─────────────────────────────────────────────────

    /**
     * Detect existing remotes for a repo (useful for cloned repos).
     * Returns array of { name, url } pairs.
     */
    async detectRemotes(folderPath: string): Promise<{ name: string; fetchUrl: string; pushUrl: string }[]> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        const remotes = await instance.git.getRemotes(true);
        return remotes.map((r) => ({
            name: r.name,
            fetchUrl: r.refs.fetch || "",
            pushUrl: r.refs.push || "",
        }));
    }

    /**
     * Detect existing remotes from an absolute path (before repo is added to registry).
     * Used by AddRepoModal for pre-filling settings.
     */
    async detectRemotesFromPath(absolutePath: string): Promise<{ name: string; fetchUrl: string }[]> {
        const git = simpleGit({
            baseDir: absolutePath,
            binary: this.gitBinary,
            config: ["core.quotepath=off"],
        });

        try {
            const isRepo = await git.checkIsRepo();
            if (!isRepo) return [];
            const remotes = await git.getRemotes(true);
            return remotes.map((r) => ({
                name: r.name,
                fetchUrl: r.refs.fetch || "",
            }));
        } catch {
            return [];
        }
    }

    /**
     * Configure git credentials for HTTPS push/pull using credential-store.
     * The PAT is written to a local .git-credentials file in the vault's .obsidian dir.
     * This avoids embedding tokens in remote URLs.
     */
    async configureCredentials(folderPath: string): Promise<void> {
        const token = this.plugin.settings.githubToken;
        const username = this.plugin.settings.githubUsername;
        if (!token || !username) return;

        const instance = this.repos.get(folderPath);
        if (!instance) return;

        // Check if remote is HTTPS (don't touch SSH remotes)
        const remotes = await instance.git.getRemotes(true);
        const origin = remotes.find((r) => r.name === (instance.config.remoteName || "origin"));
        if (!origin) return;

        const remoteUrl = origin.refs.push || origin.refs.fetch || "";
        if (!remoteUrl.startsWith("https://")) return; // SSH — leave it alone

        // Write credentials to a private file in .obsidian
        // Use configDir to support custom configuration folders
        const configDir = this.plugin.app.vault.configDir;
        const credPath = `${this.vaultBasePath}/${configDir}/plugins/obsidian-folder-git/.git-credentials`;
        const credLine = `https://${username}:${token}@github.com\n`;
        // Ensure directory exists
        const credDir = credPath.substring(0, credPath.lastIndexOf("/"));
        if (!fs.existsSync(credDir)) {
            fs.mkdirSync(credDir, { recursive: true });
        }
        fs.writeFileSync(credPath, credLine, { mode: 0o600 });

        // Configure this repo to use credential-store pointing to our file
        await instance.git.addConfig("credential.helper", `store --file="${credPath}"`, false, "local");
    }

    /** Push to remote, setting upstream on first push */
    async push(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        // Ensure credentials are configured before push
        await this.configureCredentials(folderPath);

        // Check if upstream is configured
        const status = await instance.git.status();
        const tracking = status.tracking;

        if (!tracking) {
            // First push — set upstream
            const branch = status.current || "main";
            const remoteName = instance.config.remoteName || "origin";
            await instance.git.push(["-u", remoteName, branch]);
        } else {
            await instance.git.push();
        }
    }

    /** Pull from remote */
    async pull(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        // Ensure credentials are configured before pull
        await this.configureCredentials(folderPath);
        await instance.git.pull();
    }

    // ─── Gitignore Management ──────────────────────────────────────────────

    /**
     * Check if a file is explicitly listed in .gitignore (Sync).
     * Used for context menu to decide whether to show Add/Remove.
     */
    checkExplicitlyIgnored(folderPath: string, relativePath: string): boolean {
        const instance = this.repos.get(folderPath);
        if (!instance) return false;

        const gitignorePath = `${instance.absolutePath}/.gitignore`;

        if (!fs.existsSync(gitignorePath)) return false;

        const content = fs.readFileSync(gitignorePath, "utf8");
        const lines = content.split(/\r?\n/);

        return lines.some((line: string) => {
            const trimmed = line.trim();
            return trimmed === relativePath || trimmed === relativePath + "/";
        });
    }

    /**
     * Check if a file is currently ignored by git.
     * Use check-ignore command.
     */
    async checkIgnored(folderPath: string, relativePath: string): Promise<boolean> {
        const instance = this.repos.get(folderPath);
        if (!instance) return false;

        try {
            // git check-ignore returns 0 exit code if ignored, 1 if not.
            // simple-git throws error on non-zero exit code usually, but checks might return string.
            // basic check:
            await instance.git.raw(["check-ignore", "-q", relativePath]);
            return true;
        } catch {
            return false;
        }
    }

    /** Add a path to .gitignore */
    addToGitignore(folderPath: string, relativePath: string): void {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        const gitignorePath = `${instance.absolutePath}/.gitignore`;

        // Append to .gitignore
        // Ensure we start on a new line
        let content = "";
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, "utf8");
            if (content.length > 0 && !content.endsWith("\n")) {
                content += "\n";
            }
        }

        content += `${relativePath}\n`;
        fs.writeFileSync(gitignorePath, content);
    }

    /** Remove a path from .gitignore */
    removeFromGitignore(folderPath: string, relativePath: string): void {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo for "${folderPath}"`);

        const gitignorePath = `${instance.absolutePath}/.gitignore`;

        if (!fs.existsSync(gitignorePath)) return;

        let content = fs.readFileSync(gitignorePath, "utf8");
        const lines = content.split(/\r?\n/);

        // Remove lines that match exactly relativePath or relativePath/
        const newLines = lines.filter((line: string) => {
            const trimmed = line.trim();
            return trimmed !== relativePath && trimmed !== relativePath + "/";
        });

        fs.writeFileSync(gitignorePath, newLines.join("\n"));
    }

    // ─── Auto-commit ───────────────────────────────────────────────────────

    private async autoCommit(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) return;

        try {
            const status = await instance.git.status();
            if (status.files.length === 0) return;

            await instance.git.add(".");
            const message = instance.config.commitMessageTemplate.replace(
                "{{date}}",
                new Date().toISOString()
            );
            await instance.git.commit(message);

            if (instance.config.autoPush) {
                await this.push(folderPath);
            }
        } catch (e) {
            console.error(`Folder Git: Auto-commit failed for "${folderPath}":`, e);
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private mapStatus(s: string): FileChangeType {
        switch (s) {
            case "M": return "M";
            case "A": return "A";
            case "D": return "D";
            case "R": return "R";
            case "?": return "?";
            case "U": return "U";
            default: return "M";
        }
    }
}
