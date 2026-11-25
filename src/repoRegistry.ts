import { simpleGit, CheckRepoActions, type SimpleGit, type SimpleGitOptions } from "simple-git";
import { FileSystemAdapter, Notice } from "obsidian";
import { fs, path, processEnv } from "./nodeApi";
import {
    renderCommitMessage,
    type FolderRepoConfig,
    type RepoInstance,
    type RepoStatus,
    type FileStatusResult,
    type FileChangeType,
    type GitLogEntry,
    type CommitMessage,
    type RepoError,
    type StashEntry,
    type ConflictSide,
    type FolderGitPluginInterface,
} from "./types";
import { findAccountForRemote, httpRemoteHost } from "./hosting/hostingService";

/**
 * Git credential helper that answers "get" requests from environment variables,
 * strictly verifying that both protocol and host on stdin match the intended remote.
 * The token is passed to the git child process via env only — it is never written
 * to disk, to .git/config, or embedded in remote URLs.
 */
const ENV_CREDENTIAL_HELPER =
    '!f() { test "$1" = get || return 0; p=""; h=""; ' +
    'while IFS="=" read -r k v; do test -z "$k" && break; ' +
    'case "$k" in protocol) p="$v";; host) h="$v";; esac; done; ' +
    'test "$p" = "$FOLDER_GIT_PROTOCOL" && test "$h" = "$FOLDER_GIT_HOST" || return 0; ' +
    'printf "username=%s\\npassword=%s\\n" "$FOLDER_GIT_USERNAME" "$FOLDER_GIT_TOKEN"; }; f';

type EnvMap = Record<string, string | undefined>;

/**
 * Environment variables (lowercase) stripped from git child processes because this plugin
 * runs git non-interactively and should not inherit risky config/exec/askpass overrides.
 */
const STRIPPED_ENV_KEYS = new Set([
    "editor",
    "git_askpass",
    "git_config",
    "git_config_count",
    "git_config_global",
    "git_config_parameters",
    "git_config_system",
    "git_editor",
    "git_exec_path",
    "git_external_diff",
    "git_pager",
    "git_proxy_command",
    "git_sequence_editor",
    "git_template_dir",
    "pager",
    "prefix",
    "ssh_askpass",
    "visual",
]);

/**
 * RepoRegistry: manages N SimpleGit instances, one per configured folder.
 */
export class RepoRegistry {
    private repos: Map<string, RepoInstance> = new Map();
    private plugin: FolderGitPluginInterface;
    /** Per-repo promise chain so mutating/network operations never overlap */
    private queues: Map<string, Promise<unknown>> = new Map();
    /** Last unresolved failure per repo (auto-commit/push, manual push/pull/sync) */
    private errors: Map<string, RepoError> = new Map();

    constructor(plugin: FolderGitPluginInterface) {
        this.plugin = plugin;
    }

    /** Vault base path on disk */
    private get vaultBasePath(): string {
        return (this.plugin.app.vault.adapter as FileSystemAdapter).getBasePath();
    }

    /** Resolve a vault-relative folder path to an absolute path, enforcing vault containment */
    resolveAbsolutePath(folderPath: string): string {
        const base = path.resolve(this.vaultBasePath);
        if (folderPath === "" || folderPath === "/") return base;
        if (folderPath.includes("\0")) {
            throw new Error(`Invalid repository path "${folderPath}".`);
        }
        const cleaned = folderPath.replace(/^\/+/, "");
        const resolved = path.resolve(base, cleaned);
        const rel = path.relative(base, resolved);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Repository path "${folderPath}" escapes the vault directory.`);
        }
        if (fs.existsSync(resolved) && fs.existsSync(base)) {
            const realBase = fs.realpathSync(base);
            const realResolved = fs.realpathSync(resolved);
            const realRel = path.relative(realBase, realResolved);
            if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
                throw new Error(`Repository path "${folderPath}" points outside the vault directory.`);
            }
        }
        return resolved;
    }

    /**
     * Create a simple-git instance.
     *
     * Strips interactive/risky Git environment overrides so simple-git's built-in
     * safety guards remain active. Only SSH command variables are preserved if present.
     */
    private createGit(
        baseDir: string | undefined,
        extraEnv: EnvMap = {},
        extraConfig: string[] = [],
        allowCredentialHelper = false
    ): SimpleGit {
        const binary = this.plugin.settings.gitBinaryPath.trim();
        if (binary) {
            if (/[\r\n\0]/.test(binary) || !fs.existsSync(binary) || !fs.statSync(binary).isFile()) {
                throw new Error(`Invalid Git binary path: "${binary}".`);
            }
        }

        const env: EnvMap = {};
        for (const [key, value] of Object.entries(processEnv())) {
            if (!STRIPPED_ENV_KEYS.has(key.toLowerCase().trim())) {
                env[key] = value;
            }
        }
        Object.assign(env, extraEnv);

        const unsafe: Record<string, boolean> = {};
        // User-provided binary paths commonly contain spaces (e.g. "C:\Program Files\Git\...")
        if (binary) unsafe.allowUnsafeCustomBinary = true;
        // Only our fixed, host-verified ENV_CREDENTIAL_HELPER is ever passed as credential.helper
        if (allowCredentialHelper) unsafe.allowUnsafeCredentialHelper = true;
        if ("GIT_SSH" in env || "GIT_SSH_COMMAND" in env) {
            unsafe.allowUnsafeSshCommand = true;
        }

        const options: Partial<SimpleGitOptions> = {
            baseDir,
            binary: binary || undefined,
            config: ["core.quotepath=off", ...extraConfig],
            unsafe,
            allowEnvironment: Object.keys(env),
        };
        return simpleGit(options).env(env);
    }

    /**
     * Create a short-lived git instance for network operations against `remoteUrl`.
     * If a configured hosting account matches the remote host, credentials are
     * supplied through a host-scoped, env-based credential helper.
     */
    private networkGit(baseDir: string | undefined, remoteUrl: string): SimpleGit {
        const env: EnvMap = { GIT_TERMINAL_PROMPT: "0" };

        const account = findAccountForRemote(this.plugin.settings, remoteUrl);
        const remote = httpRemoteHost(remoteUrl);
        if (!account || !remote) return this.createGit(baseDir, env);

        if (/[\r\n]/.test(account.username) || /[\r\n]/.test(account.token)) {
            throw new Error("Invalid characters in hosting credentials.");
        }

        env.FOLDER_GIT_PROTOCOL = remote.protocol;
        env.FOLDER_GIT_HOST = remote.host;
        env.FOLDER_GIT_USERNAME = account.username;
        env.FOLDER_GIT_TOKEN = account.token;

        const origin = `${remote.protocol}://${remote.host}`;
        // Empty value resets inherited helpers; scope our helper to the exact origin
        return this.createGit(
            baseDir,
            env,
            ["credential.helper=", `credential.${origin}.helper=${ENV_CREDENTIAL_HELPER}`],
            true
        );
    }

    /** Run `fn` after any pending operation on the same repo has finished */
    private exclusive<T>(folderPath: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.queues.get(folderPath) ?? Promise.resolve();
        const next = prev.catch(() => undefined).then(fn);
        this.queues.set(folderPath, next);
        void next.finally(() => {
            if (this.queues.get(folderPath) === next) this.queues.delete(folderPath);
        }).catch(() => undefined);
        return next;
    }

    private require(folderPath: string): RepoInstance {
        const instance = this.repos.get(folderPath);
        if (!instance) throw new Error(`No repo configured for "${folderPath || "vault root"}"`);
        return instance;
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    /** Initialize all configured repos on plugin load */
    async initialize(): Promise<void> {
        this.removeLegacyCredentialFiles();
        for (const config of this.plugin.settings.repos) {
            try {
                await this.addRepo(config);
            } catch (e) {
                new Notice(`Folder Git: failed to initialize repo for "${config.folderPath || "vault root"}": ${(e as Error).message}`);
            }
        }
    }

    /** Clean up all repos (timers, etc.) on plugin unload */
    destroy(): void {
        for (const [, instance] of this.repos) {
            if (instance.autoCommitTimer) {
                window.clearInterval(instance.autoCommitTimer);
            }
        }
        this.repos.clear();
    }

    // ─── Repo Management ───────────────────────────────────────────────────

    /** Add and initialize a repo for a folder */
    async addRepo(config: FolderRepoConfig): Promise<void> {
        const absolutePath = this.resolveAbsolutePath(config.folderPath);

        // Status refreshes must not take index.lock and collide with user operations
        const git = this.createGit(absolutePath, { GIT_OPTIONAL_LOCKS: "0" });

        // Verify this folder is itself a repository root (not just inside another one)
        const isRoot = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
        if (!isRoot) {
            throw new Error(`"${config.folderPath || "vault root"}" is not a Git repository root`);
        }

        const existing = this.repos.get(config.folderPath);
        if (existing?.autoCommitTimer) window.clearInterval(existing.autoCommitTimer);

        const instance: RepoInstance = {
            config,
            git,
            absolutePath,
        };
        this.repos.set(config.folderPath, instance);
        this.updateAutoCommit(config.folderPath);

        await this.removeLegacyCredentialConfig(absolutePath);
        if (config.folderPath === "") this.protectPluginData();
    }

    /** Remove a repo from tracking (does NOT delete the .git folder) */
    removeRepo(folderPath: string): void {
        const instance = this.repos.get(folderPath);
        if (instance?.autoCommitTimer) {
            window.clearInterval(instance.autoCommitTimer);
        }
        this.repos.delete(folderPath);
        this.errors.delete(folderPath);
    }

    /** (Re)start the auto-commit timer after the interval setting changed */
    updateAutoCommit(folderPath: string): void {
        const instance = this.repos.get(folderPath);
        if (!instance) return;
        if (instance.autoCommitTimer) {
            window.clearInterval(instance.autoCommitTimer);
            instance.autoCommitTimer = undefined;
        }
        if (instance.config.autoCommitInterval > 0) {
            instance.autoCommitTimer = window.setInterval(
                () => { void this.autoCommit(folderPath); },
                instance.config.autoCommitInterval * 60 * 1000
            );
        }
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
        const instance = this.require(folderPath);

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
            if (file.working_dir === "U" || file.index === "U" || status.conflicted.includes(file.path)) {
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
            tracking: status.tracking || "",
            staged,
            changed,
            untracked,
            conflicted,
            ahead: status.ahead,
            behind: status.behind,
            merging: fs.existsSync(`${instance.absolutePath}/.git/MERGE_HEAD`),
        };
    }

    /** Stage files in a repo */
    async stage(folderPath: string, files: string[]): Promise<void> {
        if (files.length === 0) return;
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => instance.git.add(["--", ...files]));
    }

    /** Stage all files in a repo */
    async stageAll(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => instance.git.add(["-A", "."]));
    }

    /** Unstage files in a repo (works before the first commit too) */
    async unstage(folderPath: string, files: string[]): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            if (await this.hasCommits(instance.git)) {
                await instance.git.reset(["HEAD", "--", ...files]);
            } else {
                await instance.git.raw(["rm", "--cached", "-r", "-q", "--", ...files]);
            }
        });
    }

    /** Unstage all files in a repo (works before the first commit too) */
    async unstageAll(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            if (await this.hasCommits(instance.git)) {
                await instance.git.reset(["HEAD"]);
            } else {
                await instance.git.raw(["rm", "--cached", "-r", "-q", "."]);
            }
        });
    }

    /** Discard working tree changes for a file (checkout from index) */
    async discard(folderPath: string, file: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => instance.git.checkout(["--", file]));
    }

    /** Commit staged changes */
    async commit(folderPath: string, message: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            const status = await instance.git.status();
            if (!status.files.some((f) => f.index && f.index !== " " && f.index !== "?")) {
                throw new Error("Nothing staged to commit.");
            }
            await instance.git.commit(message);
        });
    }

    /** Stage everything and commit. A function message is rendered once the files and branch are known. */
    async commitAll(folderPath: string, message: CommitMessage): Promise<boolean> {
        const instance = this.require(folderPath);
        return this.exclusive(folderPath, async () => {
            await instance.git.add(["-A", "."]);
            const status = await instance.git.status();
            if (status.isClean()) return false;
            const text = typeof message === "string"
                ? message
                : message({
                    repo: folderPath || this.plugin.app.vault.getName(),
                    branch: status.current || "HEAD",
                    files: status.files.length,
                });
            await instance.git.commit(text);
            return true;
        });
    }

    // ─── Last error per repo ────────────────────────────────────────────────

    /** Last failure that has not been followed by a success, if any */
    getError(folderPath: string): RepoError | undefined {
        return this.errors.get(folderPath);
    }

    /** Record a failure. Returns true when it differs from the one already recorded. */
    setError(folderPath: string, action: RepoError["action"], message: string): boolean {
        const previous = this.errors.get(folderPath);
        this.errors.set(folderPath, { action, message, time: Date.now() });
        return previous?.message !== message;
    }

    clearError(folderPath: string): void {
        this.errors.delete(folderPath);
    }

    /** Get diff for a specific file (working tree vs index, or index vs HEAD) */
    async getDiff(folderPath: string, file: string, staged: boolean = false): Promise<string> {
        const instance = this.require(folderPath);
        const args = staged ? ["--cached", "--", file] : ["--", file];
        return await instance.git.diff(args);
    }

    /** Get the diff introduced by a single file in a commit */
    async getCommitFileDiff(folderPath: string, hash: string, file: string): Promise<string> {
        const instance = this.require(folderPath);
        return await instance.git.show(["--format=", hash, "--", file]);
    }

    /** Replace a file's working copy with its version in a commit (left unstaged) */
    async restoreFile(folderPath: string, hash: string, file: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () =>
            instance.git.raw(["restore", `--source=${hash}`, "--worktree", "--", file])
        );
    }

    /**
     * Get commit log, newest first.
     * `skip` pages through older commits; `file` (repo-relative) limits it to commits touching
     * that file, following renames.
     */
    async getLog(
        folderPath: string,
        limit: number = 50,
        options: { skip?: number; file?: string } = {}
    ): Promise<GitLogEntry[]> {
        const instance = this.require(folderPath);
        if (!(await this.hasCommits(instance.git))) return [];

        const log = await instance.git.log({
            maxCount: limit,
            "--stat": null,
            ...(options.skip ? { "--skip": options.skip } : {}),
            ...(options.file ? { file: options.file, "--follow": null } : {}),
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
        const instance = this.require(folderPath);
        const status = await instance.git.status();
        return status.current || "HEAD";
    }

    /** Get all branches */
    async getBranches(folderPath: string): Promise<{ current: string; all: string[] }> {
        const instance = this.require(folderPath);
        const branches = await instance.git.branchLocal();
        return {
            current: branches.current,
            all: branches.all,
        };
    }

    /** Local branches plus remote branches that have no local counterpart (as "remote/name") */
    async listBranches(folderPath: string): Promise<{ current: string; local: string[]; remoteOnly: string[] }> {
        const instance = this.require(folderPath);
        const branches = await instance.git.branch(["-a"]);
        const local = branches.all.filter((n) => !n.startsWith("remotes/"));
        const remoteOnly = branches.all
            .filter((n) => n.startsWith("remotes/") && !n.endsWith("/HEAD"))
            .map((n) => n.slice("remotes/".length))
            .filter((n) => !local.includes(n.slice(n.indexOf("/") + 1)));
        return { current: branches.current, local, remoteOnly };
    }

    /** Refuse names git could mistake for an option */
    private assertRefName(name: string, label = "branch"): void {
        if (!name || name.startsWith("-") || /[\r\n\0]/.test(name)) {
            throw new Error(`Invalid ${label} name "${name}".`);
        }
    }

    /** Allow only safe remote URL schemes and refuse option-like strings */
    private assertRemoteUrl(url: string): void {
        const trimmed = url.trim();
        if (!trimmed || trimmed.startsWith("-") || /[\r\n\0]/.test(trimmed)) {
            throw new Error(`Invalid remote URL "${url}".`);
        }
        const isHttpOrSsh = /^(https?|ssh|git):\/\/.+/i.test(trimmed);
        const isScpSsh = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/.test(trimmed);
        if (!isHttpOrSsh && !isScpSsh) {
            throw new Error(`Unsupported remote URL scheme. Use https://, ssh://, git://, or user@host:path.`);
        }
    }

    /** Checkout a local branch, or create a tracking branch from a "remote/name" ref */
    async checkout(folderPath: string, branch: string, track = false): Promise<void> {
        this.assertRefName(branch);
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () =>
            track ? instance.git.raw(["checkout", "--track", branch]) : instance.git.checkout(branch)
        );
    }

    /** Create a branch from HEAD and switch to it */
    async createBranch(folderPath: string, name: string): Promise<void> {
        this.assertRefName(name);
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            try {
                await instance.git.raw(["check-ref-format", "--branch", name]);
            } catch {
                throw new Error(`"${name}" is not a valid branch name.`);
            }
            await instance.git.raw(["checkout", "-b", name]);
        });
    }

    /** Delete a local branch. Without `force`, git refuses branches that are not fully merged. */
    async deleteBranch(folderPath: string, name: string, force = false): Promise<void> {
        this.assertRefName(name);
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () =>
            instance.git.raw(["branch", force ? "-D" : "-d", "--", name])
        );
    }

    /** Merge a branch into the current one. Conflicts leave the merge in progress and throw. */
    async mergeBranch(folderPath: string, name: string): Promise<void> {
        this.assertRefName(name);
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            await instance.git.merge([name, "--no-edit"]);
        });
    }

    async abortMerge(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => instance.git.raw(["merge", "--abort"]));
    }

    // ─── Stash ──────────────────────────────────────────────────────────────

    /** Stash tracked and untracked changes. Throws when there is nothing to stash. */
    async stashPush(folderPath: string, message: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            const args = ["stash", "push", "--include-untracked"];
            if (message) args.push("-m", message);
            const out = await instance.git.raw(args);
            if (/no local changes/i.test(out)) throw new Error("No local changes to stash.");
        });
    }

    async stashList(folderPath: string): Promise<StashEntry[]> {
        const instance = this.require(folderPath);
        const out = await instance.git.raw(["stash", "list", "--format=%gs%x1f%cI"]);
        return out
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line, index) => {
                const [subject, date] = line.split("\x1f");
                // "On main: my note" / "WIP on main: abc123 subject" -> drop the branch prefix for readability
                return { index, message: subject.replace(/^(WIP on|On) [^:]*: /, ""), date: date ?? "" };
            });
    }

    /** Apply (keeping the stash), pop (apply then drop) or drop a stash entry */
    async stashOperate(folderPath: string, op: "apply" | "pop" | "drop", index: number): Promise<void> {
        if (!Number.isInteger(index) || index < 0) throw new Error("Invalid stash index.");
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => instance.git.raw(["stash", op, `stash@{${index}}`]));
    }

    // ─── Rewriting the last commit ──────────────────────────────────────────

    async getLastCommitMessage(folderPath: string): Promise<string> {
        const instance = this.require(folderPath);
        return (await instance.git.raw(["log", "-1", "--format=%B"])).trim();
    }

    /** Replace the last commit: new message plus anything currently staged */
    async amendLastCommit(folderPath: string, message: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            if (!(await this.hasCommits(instance.git))) throw new Error("No commits to amend.");
            await instance.git.raw(["commit", "--amend", "-m", message]);
        });
    }

    /** Undo the last commit but keep its changes staged */
    async undoLastCommit(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            try {
                await instance.git.raw(["rev-parse", "--verify", "-q", "HEAD~1"]);
            } catch {
                throw new Error("There is no earlier commit to go back to.");
            }
            await instance.git.raw(["reset", "--soft", "HEAD~1"]);
        });
    }

    // ─── Conflicts ──────────────────────────────────────────────────────────

    /** Resolve a conflicted file by taking one side wholesale, then stage it */
    async resolveConflict(folderPath: string, file: string, side: ConflictSide): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            await instance.git.raw(["checkout", `--${side}`, "--", file]);
            await instance.git.add(["--", file]);
        });
    }

    /** Init a new git repo in a folder */
    async initRepo(absolutePath: string): Promise<void> {
        const git = this.createGit(absolutePath);
        await git.init();
    }

    /** Clone a repo into a folder (uses configured hosting credentials when the host matches) */
    async cloneRepo(url: string, absolutePath: string): Promise<void> {
        this.assertRemoteUrl(url);
        if (fs.existsSync(absolutePath) && fs.readdirSync(absolutePath).length > 0) {
            throw new Error("Target folder is not empty. Choose an empty folder or a new subfolder name.");
        }
        await this.networkGit(undefined, url).raw(["clone", "--", url, absolutePath]);
    }

    /** Add a remote, or update its URL if it already exists */
    async setRemoteUrl(folderPath: string, name: string, url: string): Promise<void> {
        const instance = this.require(folderPath);
        if (!url) return;
        this.assertRefName(name, "remote");
        this.assertRemoteUrl(url);
        await this.exclusive(folderPath, async () => {
            const remotes = await instance.git.getRemotes();
            if (remotes.some((r) => r.name === name)) {
                await instance.git.raw(["remote", "set-url", "--", name, url]);
            } else {
                await instance.git.raw(["remote", "add", "--", name, url]);
            }
        });
    }

    // ─── Remotes ────────────────────────────────────────────────────────────

    /**
     * Detect existing remotes for a repo (useful for cloned repos).
     * Returns array of { name, url } pairs.
     */
    async detectRemotes(folderPath: string): Promise<{ name: string; fetchUrl: string; pushUrl: string }[]> {
        const instance = this.require(folderPath);

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
        if (!fs.existsSync(`${absolutePath}/.git`)) return [];
        const git = this.createGit(absolutePath);

        try {
            const remotes = await git.getRemotes(true);
            return remotes.map((r) => ({
                name: r.name,
                fetchUrl: r.refs.fetch || "",
            }));
        } catch {
            return [];
        }
    }

    /** URL of the repo's target remote (preferring the tracking remote when `tracking` is provided) */
    private async getRemoteUrl(instance: RepoInstance, tracking?: string): Promise<string> {
        const remotes = await instance.git.getRemotes(true);
        let remote: (typeof remotes)[number] | undefined;

        if (tracking) {
            // Match the longest configured remote name that prefixes "<remote>/<branch>"
            const matches = remotes
                .filter((r) => tracking.startsWith(`${r.name}/`))
                .sort((a, b) => b.name.length - a.name.length);
            remote = matches[0];
        }

        if (!remote) {
            const remoteName = instance.config.remoteName || "origin";
            this.assertRefName(remoteName, "remote");
            remote = remotes.find((r) => r.name === remoteName);
            if (!remote) {
                throw new Error(`Remote "${remoteName}" is not configured. Set a remote URL in the plugin settings.`);
            }
        }
        return remote.refs.push || remote.refs.fetch || "";
    }

    /** Push to remote, setting upstream on first push */
    async push(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => this.pushUnlocked(instance));
    }

    private async pushUnlocked(instance: RepoInstance): Promise<void> {
        if (!(await this.hasCommits(instance.git))) {
            throw new Error("No commits yet — commit before pushing.");
        }

        const status = await instance.git.status();
        const remoteUrl = await this.getRemoteUrl(instance, status.tracking || undefined);
        const net = this.networkGit(instance.absolutePath, remoteUrl);

        if (!status.tracking) {
            // First push — set upstream
            if (!status.current || status.detached) {
                throw new Error("Cannot push from a detached HEAD.");
            }
            const remoteName = instance.config.remoteName || "origin";
            this.assertRefName(remoteName, "remote");
            this.assertRefName(status.current);
            await net.push(["-u", remoteName, status.current]);
        } else {
            await net.push();
        }
    }

    /** Pull from remote (sets upstream if the branch is not tracking yet) */
    async pull(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, () => this.pullUnlocked(instance));
    }

    private async pullUnlocked(instance: RepoInstance): Promise<void> {
        const status = await instance.git.status();
        const remoteUrl = await this.getRemoteUrl(instance, status.tracking || undefined);
        const net = this.networkGit(instance.absolutePath, remoteUrl);

        if (status.tracking) {
            await net.pull();
            return;
        }

        if (!status.current || status.detached) {
            throw new Error("Cannot pull into a detached HEAD.");
        }
        const remoteName = instance.config.remoteName || "origin";
        this.assertRefName(remoteName, "remote");
        this.assertRefName(status.current);
        await net.fetch(remoteName);
        const remoteBranches = await instance.git.branch(["-r"]);
        const remoteRef = `${remoteName}/${status.current}`;
        if (!remoteBranches.all.includes(remoteRef)) {
            throw new Error(`Remote branch "${remoteRef}" does not exist yet. Push first.`);
        }
        await net.pull(remoteName, status.current);
        await instance.git.branch(["--set-upstream-to", remoteRef]);
    }

    /** Pull then push */
    async sync(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            const status = await instance.git.status();
            if (status.tracking) {
                await this.pullUnlocked(instance);
            }
            await this.pushUnlocked(instance);
        });
    }

    /** Fetch from remote to refresh ahead/behind counters */
    async fetch(folderPath: string): Promise<void> {
        const instance = this.require(folderPath);
        await this.exclusive(folderPath, async () => {
            const remoteName = instance.config.remoteName || "origin";
            this.assertRefName(remoteName, "remote");
            const remoteUrl = await this.getRemoteUrl(instance);
            await this.networkGit(instance.absolutePath, remoteUrl).fetch(remoteName);
        });
    }

    // ─── Legacy credential cleanup ─────────────────────────────────────────

    /**
     * Versions ≤1.0.4 stored the PAT in a plaintext credential-store file and pointed
     * the repo's local credential.helper at it. Remove that configuration.
     */
    private async removeLegacyCredentialConfig(absolutePath: string): Promise<void> {
        try {
            // Touching credential.helper requires the explicit simple-git opt-in
            await this.createGit(absolutePath, {}, [], true).raw(["config", "--local", "--unset-all", "credential.helper", "folder-git.*\\.git-credentials"]);
        } catch {
            // Exit code 5 = nothing to unset
        }
    }

    private removeLegacyCredentialFiles(): void {
        const configDir = this.plugin.app.vault.configDir;
        const candidates = [
            `${this.vaultBasePath}/${configDir}/plugins/obsidian-folder-git/.git-credentials`,
            `${this.vaultBasePath}/${configDir}/plugins/${this.plugin.manifest.id}/.git-credentials`,
        ];
        for (const file of candidates) {
            try {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch {
                // Ignore — best-effort cleanup
            }
        }
    }

    /**
     * A vault-root repository contains the plugin's data.json, which holds the access tokens.
     * Make sure it is ignored, and warn if it has already been committed.
     */
    private protectPluginData(): void {
        const dataPath = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/data.json`;
        void this.exclusive("", async () => {
            const instance = this.repos.get("");
            if (!instance) return;
            if (!(await this.checkIgnored("", dataPath))) {
                this.addToGitignore("", dataPath);
                new Notice(`Folder Git: added "${dataPath}" to the vault's .gitignore because it contains your access tokens.`);
            }
            try {
                // Succeeds only if the file is tracked
                await instance.git.raw(["ls-files", "--error-unmatch", "--", dataPath]);
                new Notice(
                    `Folder Git: "${dataPath}" is already committed and contains your access tokens. ` +
                    `Run "git rm --cached ${dataPath}", and revoke the tokens if you have pushed it.`,
                    0
                );
            } catch {
                // Not tracked
            }
        }).catch((e: Error) => {
            new Notice(`Folder Git: could not protect "${dataPath}": ${e.message}`);
        });
    }

    // ─── Gitignore Management ──────────────────────────────────────────────

    private gitignorePath(folderPath: string): string {
        return `${this.require(folderPath).absolutePath}/.gitignore`;
    }

    /** Read .gitignore contents ("" if missing) */
    readGitignore(folderPath: string): string {
        const p = this.gitignorePath(folderPath);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    }

    /** Overwrite .gitignore contents */
    writeGitignore(folderPath: string, content: string): void {
        const normalized = content.length > 0 && !content.endsWith("\n") ? content + "\n" : content;
        fs.writeFileSync(this.gitignorePath(folderPath), normalized);
    }

    /**
     * Check if a file is explicitly listed in .gitignore (Sync).
     * Used for context menu to decide whether to show Add/Remove.
     */
    checkExplicitlyIgnored(folderPath: string, relativePath: string): boolean {
        if (!this.repos.has(folderPath)) return false;
        return this.readGitignore(folderPath)
            .split(/\r?\n/)
            .some((line: string) => this.matchesEntry(line, relativePath));
    }

    /** Check if a file is currently ignored by git (git check-ignore) */
    async checkIgnored(folderPath: string, relativePath: string): Promise<boolean> {
        const instance = this.repos.get(folderPath);
        if (!instance) return false;

        try {
            // check-ignore exits 0 if ignored, 1 if not (simple-git throws on non-zero)
            await instance.git.raw(["check-ignore", "-q", "--", relativePath]);
            return true;
        } catch {
            return false;
        }
    }

    /** Add a path to .gitignore (no-op if already listed) */
    addToGitignore(folderPath: string, relativePath: string): void {
        if (this.checkExplicitlyIgnored(folderPath, relativePath)) return;

        let content = this.readGitignore(folderPath);
        if (content.length > 0 && !content.endsWith("\n")) {
            content += "\n";
        }
        content += `${relativePath}\n`;
        this.writeGitignore(folderPath, content);
    }

    /** Remove a path from .gitignore */
    removeFromGitignore(folderPath: string, relativePath: string): void {
        const content = this.readGitignore(folderPath);
        if (!content) return;

        const newLines = content
            .split(/\r?\n/)
            .filter((line: string) => !this.matchesEntry(line, relativePath));

        this.writeGitignore(folderPath, newLines.join("\n"));
    }

    private matchesEntry(line: string, relativePath: string): boolean {
        const trimmed = line.trim().replace(/^\//, "");
        return trimmed === relativePath || trimmed === relativePath + "/";
    }

    // ─── Auto-commit ───────────────────────────────────────────────────────

    private async autoCommit(folderPath: string): Promise<void> {
        const instance = this.repos.get(folderPath);
        if (!instance) return;

        let action: RepoError["action"] = "commit";
        try {
            const committed = await this.commitAll(
                folderPath,
                (ctx) => renderCommitMessage(instance.config.commitMessageTemplate, ctx)
            );
            if (committed && instance.config.autoPush) {
                action = "push";
                await this.push(folderPath);
            }
            // A commit that succeeded without pushing must not hide an earlier push failure
            if (action === "push" || this.errors.get(folderPath)?.action === "commit") {
                this.clearError(folderPath);
            }
        } catch (e) {
            const message = (e as Error).message;
            // Notify once per distinct failure so a persistent problem does not nag every interval
            if (this.setError(folderPath, action, message)) {
                new Notice(`Folder Git: auto-${action} failed for "${folderPath || "vault root"}": ${message}`);
            }
        } finally {
            void this.plugin.refreshViews();
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private async hasCommits(git: SimpleGit): Promise<boolean> {
        try {
            await git.raw(["rev-parse", "--verify", "-q", "HEAD"]);
            return true;
        } catch {
            return false;
        }
    }

    private mapStatus(s: string): FileChangeType {
        switch (s) {
            case "M": return "M";
            case "A": return "A";
            case "D": return "D";
            case "R": return "R";
            case "C": return "A";
            case "?": return "?";
            case "U": return "U";
            default: return "M";
        }
    }
}
