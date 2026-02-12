import { Plugin, TFolder, TAbstractFile, Menu, Notice, TFile } from "obsidian";
import * as fs from "fs";
import {
    type PluginSettings,
    type RepoStatus,
    DEFAULT_SETTINGS,
    SOURCE_CONTROL_VIEW_TYPE,
    HISTORY_VIEW_TYPE,
} from "./types";
import { RepoRegistry } from "./repoRegistry";
import { SourceControlView } from "./views/sourceControlView";
import { HistoryView } from "./views/historyView";
import { DiffModal } from "./views/diffModal";
import { AddRepoModal } from "./modals/addRepoModal";
import { FolderGitSettingsTab } from "./settingsTab";

export default class FolderGitPlugin extends Plugin {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    private ribbonIconEl: HTMLElement | null = null;
    /** Cached statuses from the last poll, keyed by folderPath */
    cachedStatuses: Map<string, RepoStatus> = new Map();
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    async onload(): Promise<void> {

        // Load settings
        await this.loadSettings();

        // Initialize repo registry
        this.repoRegistry = new RepoRegistry(this);
        await this.repoRegistry.initialize();

        // Register views
        this.registerView(SOURCE_CONTROL_VIEW_TYPE, (leaf) => new SourceControlView(leaf, this));
        this.registerView(HISTORY_VIEW_TYPE, (leaf) => new HistoryView(leaf, this));

        // Ribbon icon
        this.ribbonIconEl = this.addRibbonIcon("git-branch", "Folder Git: source control", () => {
            void this.activateSourceControlView();
        });
        this.ribbonIconEl.addClass("folder-git-ribbon-icon");

        // Commands
        this.addCommand({
            id: "open-source-control",
            name: "Open source control",
            callback: () => { void this.activateSourceControlView(); },
        });

        this.addCommand({
            id: "open-history",
            name: "Open Git history",
            callback: () => { void this.activateHistoryView(); },
        });

        this.addCommand({
            id: "add-folder-repo",
            name: "Add folder repository",
            callback: () => this.openAddRepoModal(),
        });

        this.addCommand({
            id: "commit-active-repo",
            name: "Commit (active repo)",
            callback: () => this.quickCommitActiveRepo(),
        });

        this.addCommand({
            id: "push-active-repo",
            name: "Push (active repo)",
            callback: async () => {
                const view = this.getSourceControlView();
                if (view) {
                    const paths = this.repoRegistry.getAllPaths();
                    if (paths.length > 0) {
                        try {
                            await this.repoRegistry.push(paths[0]);
                            new Notice("Push successful.");
                        } catch (e) {
                            new Notice(`Push failed: ${(e as Error).message}`);
                        }
                    }
                }
            },
        });

        this.addCommand({
            id: "pull-active-repo",
            name: "Pull (active repo)",
            callback: async () => {
                const paths = this.repoRegistry.getAllPaths();
                if (paths.length > 0) {
                    try {
                        await this.repoRegistry.pull(paths[0]);
                        new Notice("Pull successful.");
                    } catch (e) {
                        new Notice(`Pull failed: ${(e as Error).message}`);
                    }
                }
            },
        });

        this.addCommand({
            id: "open-gitignore",
            name: "Edit .gitignore",
            callback: async () => {
                // Try to get active repo from view, else first one
                const view = this.getSourceControlView();
                let folderPath = view?.currentFolderPath;

                if (!folderPath) {
                    const paths = this.repoRegistry.getAllPaths();
                    if (paths.length > 0) folderPath = paths[0];
                }

                if (folderPath) {
                    await this.openGitignoreFile(folderPath);
                } else {
                    new Notice("No repository found.");
                }
            },
        });

        // Context menu on folders in file explorer
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                const folderPath = file.path;

                // 1. Check if this specific folder is a Repo Root directly
                // (Only for folders)
                if (file instanceof TFolder) {
                    const isRepoRoot = this.settings.repos.some(
                        (r) => r.folderPath === folderPath
                    );

                    if (isRepoRoot) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: open source control")
                                .setIcon("git-branch")
                                .onClick(async () => {
                                    await this.activateSourceControlView();
                                    const view = this.getSourceControlView();
                                    if (view) {
                                        await view.setActiveRepo(folderPath);
                                    }
                                })
                        );

                        menu.addItem((item) =>
                            item
                                .setTitle("Git: open history")
                                .setIcon("history")
                                .onClick(async () => {
                                    await this.activateHistoryView();
                                    const view = this.getHistoryView();
                                    if (view) {
                                        await view.setActiveRepo(folderPath);
                                    }
                                })
                        );

                        menu.addItem((item) =>
                            item
                                .setTitle("Git: open .gitignore")
                                .setIcon("file-code")
                                .onClick(() => this.openGitignoreFile(folderPath))
                        );

                        return; // It's a repo root, don't show "Add Repo" or "Add to gitignore" for itself
                    }

                    // If not a repo root, check if it's inside another repo to offer "Add to .gitignore"
                    // But also offer "Add Repository" if it's not inside one? 
                    // To keep it simple: If inside a repo, show gitignore options. If not, show Add Repo.
                }

                // 2. Check if file is inside a repo
                const repo = this.repoRegistry.getRepoForFile(file.path);
                if (repo) {
                    // Calculate relative path
                    // folderPath is vault-relative. repo.config.folderPath is vault-relative root.
                    // We need path relative to repo root.
                    let relativePath = file.path;
                    if (repo.config.folderPath) {
                        // Remove "repoRoot/" from start
                        if (relativePath.startsWith(repo.config.folderPath + "/")) {
                            relativePath = relativePath.slice(repo.config.folderPath.length + 1);
                        }
                    }

                    const isIgnored = this.repoRegistry.checkExplicitlyIgnored(repo.config.folderPath, relativePath);

                    if (isIgnored) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: remove from .gitignore")
                                .setIcon("trash")
                                .onClick(async () => {
                                    this.repoRegistry.removeFromGitignore(repo.config.folderPath, relativePath);
                                    new Notice(`Removed "${relativePath}" from .gitignore`);
                                    await this.updateBadge(); // Refresh status
                                })
                        );
                    } else {
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: add to .gitignore")
                                .setIcon("eye-off")
                                .onClick(async () => {
                                    this.repoRegistry.addToGitignore(repo.config.folderPath, relativePath);
                                    new Notice(`Added "${relativePath}" to .gitignore`);
                                    await this.updateBadge(); // Refresh status
                                })
                        );
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: pull")
                                .setIcon("download")
                                .onClick(async () => {
                                    await this.repoRegistry.pull(repo.config.folderPath);
                                    new Notice(`Pulled changes for ${repo.config.folderPath}`);
                                })
                        );
                    }
                } else {
                    // Not in a repo, offer to create one if it's a folder
                    if (file instanceof TFolder) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: add repository")
                                .setIcon("git-branch")
                                .onClick(() => this.openAddRepoModal(folderPath))
                        );
                    }
                }
            })
        );

        // Settings tab
        this.addSettingTab(new FolderGitSettingsTab(this.app, this));

        // Start refresh timer
        this.startRefreshTimer();

        // Initial badge update (after a short delay to allow repos to init)
        setTimeout(() => { void this.updateBadge(); }, 2000);
    }

    onunload(): void {
        this.stopRefreshTimer();
        this.repoRegistry?.destroy();
    }

    // ─── Settings ───────────────────────────────────────────────────────

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    async activateSourceControlView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(SOURCE_CONTROL_VIEW_TYPE);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.app.workspace.getLeftLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: SOURCE_CONTROL_VIEW_TYPE,
                active: true,
            });
            await this.app.workspace.revealLeaf(leaf);
        }
    }

    async activateHistoryView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(HISTORY_VIEW_TYPE);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.app.workspace.getLeftLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: HISTORY_VIEW_TYPE,
                active: true,
            });
            await this.app.workspace.revealLeaf(leaf);
        }
    }

    private getSourceControlView(): SourceControlView | null {
        const leaves = this.app.workspace.getLeavesOfType(SOURCE_CONTROL_VIEW_TYPE);
        if (leaves.length > 0) {
            return leaves[0].view as SourceControlView;
        }
        return null;
    }

    private getHistoryView(): HistoryView | null {
        const leaves = this.app.workspace.getLeavesOfType(HISTORY_VIEW_TYPE);
        if (leaves.length > 0) {
            return leaves[0].view as HistoryView;
        }
        return null;
    }

    // ─── Modals ─────────────────────────────────────────────────────────

    openAddRepoModal(initialFolderPath?: string): void {
        new AddRepoModal(this.app, this, () => {
            // Refresh source control view after adding
            const view = this.getSourceControlView();
            if (view) {
                void view.render();
            }
        }, initialFolderPath).open();
    }

    openDiffModal(filePath: string, diffContent: string): void {
        new DiffModal(this.app, filePath, diffContent).open();
    }

    // ─── Auto-refresh ───────────────────────────────────────────────────

    startRefreshTimer(): void {
        this.stopRefreshTimer();
        if (this.settings.refreshInterval > 0) {
            this.refreshTimer = setInterval(() => {
                void (async () => {
                    await this.updateBadge();
                    const view = this.getSourceControlView();
                    if (view) {
                        await view.render();
                    }
                })();
            }, this.settings.refreshInterval * 1000);
        }
    }

    stopRefreshTimer(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    restartRefreshTimer(): void {
        this.startRefreshTimer();
    }

    // ─── Badge ───────────────────────────────────────────────────────────

    /** Fetch status of all repos and update the ribbon icon badge */
    async updateBadge(): Promise<void> {
        const paths = this.repoRegistry.getAllPaths();
        let totalChanges = 0;
        const newStatuses = new Map<string, RepoStatus>();

        for (const p of paths) {
            try {
                const status = await this.repoRegistry.getStatus(p);
                newStatuses.set(p, status);
                totalChanges += status.staged.length + status.changed.length + status.untracked.length;
            } catch {
                // skip repos that error
            }
        }

        this.cachedStatuses = newStatuses;

        // Update ribbon icon badge
        if (!this.ribbonIconEl) return;

        // Remove existing badge
        const existing = this.ribbonIconEl.querySelector(".folder-git-badge");
        if (existing) existing.remove();

        if (totalChanges > 0) {
            const badge = this.ribbonIconEl.createSpan({ cls: "folder-git-badge" });
            badge.setText(totalChanges > 99 ? "99+" : String(totalChanges));
        }
    }

    /** Get cached statuses (from last poll) for all repos */
    getCachedStatuses(): Map<string, RepoStatus> {
        return this.cachedStatuses;
    }

    // ─── Quick Actions ──────────────────────────────────────────────────

    private async quickCommitActiveRepo(): Promise<void> {
        const paths = this.repoRegistry.getAllPaths();
        if (paths.length === 0) {
            new Notice("No repositories configured.");
            return;
        }
        // Open source control view for commit
        await this.activateSourceControlView();
    }
    async openGitignoreFile(folderPath: string): Promise<void> {
        const repo = this.repoRegistry.getRepo(folderPath);
        if (!repo) return;

        const gitignorePath = folderPath ? `${folderPath}/.gitignore` : ".gitignore";

        // Ensure file exists
        const absPath = `${repo.absolutePath}/.gitignore`;
        if (!fs.existsSync(absPath)) {
            fs.writeFileSync(absPath, "");
        }

        // Open in Obsidian
        let file = this.app.vault.getAbstractFileByPath(gitignorePath);
        if (!file) {
            // It might exist on disk but not in Obsidian cache yet if we just created it using fs
            // or if it's hidden (dotfile).
            // Obsidian typically doesn't show dotfiles.
            // But we can try to open it if we can get a TFile.
            // If it's not in vault cache, we might need to rely on adapter or just force open?
            // Actually, Obsidian filters dotfiles by default. 
            // Users might need to enable "Detect all file extensions" or similar?
            // Or we just try to read it content and show in a modal?
            // Use `app.workspace.openLinkText` might work if we just want to create it?

            // If it's not visible, we can't open it as a regular TFile easily.
            // WE can try to create it using Vault API if it doesn't exist.
            // await this.app.vault.create(gitignorePath, "");

            // However, dotfiles are usually hidden.
            // If user can't see it, they can't edit it in Obsidian editor easily.
            // WORKAROUND: Create a temporary file or Modal?
            // No, user wants to edit.
            // Let's try to see if we can find it.
            // If we can't find it, we might error.
            if (!(await this.app.vault.adapter.exists(gitignorePath))) {
                await this.app.vault.create(gitignorePath, "");
            }
            file = this.app.vault.getAbstractFileByPath(gitignorePath);
        }

        if (file && file instanceof TFile) { // it's a file
            await this.app.workspace.getLeaf(true).openFile(file);
        } else {
            new Notice("Could not open .gitignore. Is 'detect all file extensions' enabled?");
        }
    }
}
