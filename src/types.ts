import type { SimpleGit } from "simple-git";
import type { Plugin } from "obsidian";
import type { RepoRegistry } from "./repoRegistry";

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
    /** GitHub repo name (if created via plugin) */
    githubRepoName: string;
    /** Whether the GitHub repo is private */
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
}

export interface FolderGitPluginInterface extends Plugin {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    getCachedStatuses(): Map<string, RepoStatus>;
    openAddRepoModal(initialFolderPath?: string): void;
    openDiffModal(filePath: string, diffContent: string): void;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    repos: [],
    gitBinaryPath: "",
    showUntrackedFiles: true,
    refreshInterval: 30,
    githubToken: "",
    githubUsername: "",
};

export const DEFAULT_REPO_CONFIG: Omit<FolderRepoConfig, "folderPath"> = {
    remoteName: "origin",
    remoteUrl: "",
    autoPush: true,
    autoCommitInterval: 0,
    commitMessageTemplate: "vault backup: {{date}}",
    githubRepoName: "",
    isPrivate: true,
};

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
    autoCommitTimer?: ReturnType<typeof setInterval>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SOURCE_CONTROL_VIEW_TYPE = "folder-git-source-control";
export const HISTORY_VIEW_TYPE = "folder-git-history";
