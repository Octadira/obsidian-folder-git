import type { SimpleGit } from "simple-git";
import type { Plugin } from "obsidian";
import type { RepoRegistry } from "./repoRegistry";
import type { HostingProviderId } from "./hosting/hostingService";

// ─── Plugin Settings ────────────────────────────────────────────────────────

export interface FolderRepoConfig {
    /** Path relative to vault root */
    folderPath: string;
    /** Remote name, default "origin" */
    remoteName: string;
    /** Remote URL (e.g. git@github.com:user/repo.git) */
    remoteUrl: string;
    /** Auto-push after commit */
    autoPush: boolean;
    /** Auto-commit interval in minutes (0 = disabled) */
    autoCommitInterval: number;
    /** Default commit message template. {{date}} is replaced with ISO date */
    commitMessageTemplate: string;
    /** Hosting provider the remote repo was created on via the plugin ("" = none/unknown) */
    hostingProvider: HostingProviderId | "";
    /** Remote repo name on the hosting provider (if created via plugin) */
    remoteRepoName: string;
    /** Whether the remote repo is private */
    isPrivate: boolean;
}

export interface PluginSettings {
    /** All configured folder repos */
    repos: FolderRepoConfig[];
    /** Custom git binary path (empty = use system default) */
    gitBinaryPath: string;
    /** Show untracked files in source control */
    showUntrackedFiles: boolean;
    /** Refresh interval in seconds for status polling */
    refreshInterval: number;
    /** GitHub Personal Access Token (stored locally in plugin data) */
    githubToken: string;
    /** GitHub username (auto-populated after token validation) */
    githubUsername: string;
    /** Forgejo/Gitea instance URL, e.g. https://codeberg.org */
    forgejoUrl: string;
    /** Forgejo access token (stored locally in plugin data) */
    forgejoToken: string;
    /** Forgejo username (auto-populated after token validation) */
    forgejoUsername: string;
}

export type RepoAction = "push" | "pull" | "sync" | "fetch";

export interface FolderGitPluginInterface extends Plugin {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    saveSettings(): Promise<void>;
    getCachedStatuses(): Map<string, RepoStatus>;
    refreshViews(): Promise<void>;
    runRepoAction(action: RepoAction, folderPath: string): Promise<boolean>;
    openAddRepoModal(initialFolderPath?: string, onDone?: () => void): void;
    openDiffModal(filePath: string, diffContent: string): void;
    openGitignoreFile(folderPath: string): void;
    openHistory(folderPath: string): Promise<void>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    repos: [],
    gitBinaryPath: "",
    showUntrackedFiles: true,
    refreshInterval: 30,
    githubToken: "",
    githubUsername: "",
    forgejoUrl: "",
    forgejoToken: "",
    forgejoUsername: "",
};

export const DEFAULT_REPO_CONFIG: Omit<FolderRepoConfig, "folderPath"> = {
    remoteName: "origin",
    remoteUrl: "",
    autoPush: true,
    autoCommitInterval: 0,
    commitMessageTemplate: "vault backup: {{date}}",
    hostingProvider: "",
    remoteRepoName: "",
    isPrivate: true,
};

/** Replace template placeholders in a commit message */
export function renderCommitMessage(template: string): string {
    const msg = (template || DEFAULT_REPO_CONFIG.commitMessageTemplate).split("{{date}}").join(new Date().toISOString());
    return msg.trim() || "vault backup";
}

// ─── Git Status Types ───────────────────────────────────────────────────────

export type FileChangeType = "M" | "A" | "D" | "R" | "?" | "U" | "!";

export interface FileStatusResult {
    /** Path relative to the repo root */
    path: string;
    /** Path relative to vault root */
    vaultPath: string;
    /** Index (staging area) status */
    indexStatus: string;
    /** Working tree status */
    workingTreeStatus: string;
    /** Display status for UI */
    displayStatus: FileChangeType;
}

export interface RepoStatus {
    /** Folder path in vault */
    folderPath: string;
    /** Current branch name */
    branch: string;
    /** Upstream branch (e.g. "origin/main"), "" if not tracking */
    tracking: string;
    /** Staged files (in index) */
    staged: FileStatusResult[];
    /** Modified/deleted files in working tree */
    changed: FileStatusResult[];
    /** Untracked files */
    untracked: string[];
    /** Files with merge conflicts */
    conflicted: string[];
    /** Commits ahead of remote */
    ahead: number;
    /** Commits behind remote */
    behind: number;
}

export interface GitLogEntry {
    hash: string;
    hashShort: string;
    message: string;
    author: string;
    date: string;
    /** Files changed in this commit */
    files?: string[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────

export interface RepoInstance {
    config: FolderRepoConfig;
    git: SimpleGit;
    absolutePath: string;
    /** Interval id from window.setInterval (main window, lives as long as the app) */
    autoCommitTimer?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SOURCE_CONTROL_VIEW_TYPE = "folder-git-source-control";
export const HISTORY_VIEW_TYPE = "folder-git-history";
