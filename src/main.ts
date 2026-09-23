import { Plugin, TFolder, TAbstractFile, Menu, Notice } from "obsidian";
import {
    type PluginSettings,
    type RepoStatus,
    type RepoAction,
    type FolderRepoConfig,
    DEFAULT_SETTINGS,
    DEFAULT_REPO_CONFIG,
    renderCommitMessage,
    SOURCE_CONTROL_VIEW_TYPE,
    HISTORY_VIEW_TYPE,
} from "./types";
import { RepoRegistry } from "./repoRegistry";
import { SourceControlView } from "./views/sourceControlView";
import { HistoryView } from "./views/historyView";
import { DiffModal } from "./views/diffModal";
import { AddRepoModal } from "./modals/addRepoModal";
import { GitignoreModal } from "./modals/gitignoreModal";
import { pickRepo } from "./modals/repoSuggestModal";
import { FolderGitSettingsTab } from "./settingsTab";

const ACTION_LABELS: Record<RepoAction, { running: string; done: string; failed: string }> = {
    push: { running: "Pushing...", done: "Push successful.", failed: "Push failed" },
    pull: { running: "Pulling...", done: "Pull successful.", failed: "Pull failed" },
    sync: { running: "Syncing...", done: "Sync successful.", failed: "Sync failed" },
    fetch: { running: "Fetching...", done: "Fetch complete.", failed: "Fetch failed" },
};

export default class FolderGitPlugin extends Plugin {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    private ribbonIconEl: HTMLElement | null = null;
    /** Cached statuses from the last poll, keyed by folderPath */
    cachedStatuses: Map<string, RepoStatus> = new Map();
    private refreshTimer: number | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.repoRegistry = new RepoRegistry(this);

        // Register views
        this.registerView(SOURCE_CONTROL_VIEW_TYPE, (leaf) => new SourceControlView(leaf, this));
        this.registerView(HISTORY_VIEW_TYPE, (leaf) => new HistoryView(leaf, this));

        // Ribbon icon
        this.ribbonIconEl = this.addRibbonIcon("git-branch", "Folder Git: source control", () => {
            void this.activateSourceControlView();
        });
        this.ribbonIconEl.addClass("folder-git-ribbon-icon");

        this.registerCommands();
        this.registerFileMenu();

        // Settings tab
        this.addSettingTab(new FolderGitSettingsTab(this.app, this));

        // Initialize repos once the workspace is ready so startup is not blocked by git
        this.app.workspace.onLayoutReady(() => {
            void (async () => {
                await this.repoRegistry.initialize();
                this.startRefreshTimer();
                await this.refreshViews();
            })();
        });
    }

    onunload(): void {
        this.stopRefreshTimer();
        this.repoRegistry?.destroy();
    }

    // ─── Commands ───────────────────────────────────────────────────────

    private registerCommands(): void {
        this.addCommand({
            id: "open-source-control",
            name: "Open source control",
            callback: () => { void this.activateSourceControlView(); },
        });

        this.addCommand({
            id: "open-history",
            name: "Open Git history",
            callback: () => {
                void (async () => {
                    const folderPath = await this.resolveTargetRepo();
                    if (folderPath !== null) await this.openHistory(folderPath);
                })();
            },
        });

        this.addCommand({
            id: "add-folder-repo",
            name: "Add folder repository",
            callback: () => this.openAddRepoModal(),
        });

        this.addCommand({
            id: "commit-active-repo",
            name: "Commit (active repo)",
            callback: () => {
                void (async () => {
                    const folderPath = await this.resolveTargetRepo();
                    if (folderPath === null) return;
                    await this.activateSourceControlView();
                    const view = this.getSourceControlView();
                    if (view) {
                        await view.setActiveRepo(folderPath);
                        view.focusCommitInput();
                    }
                })();
            },
        });

        this.addCommand({
            id: "commit-all-active-repo",
            name: "Commit all changes with default message (active repo)",
            callback: () => {
                void (async () => {
                    const folderPath = await this.resolveTargetRepo();
                    if (folderPath === null) return;
                    await this.getSourceControlView()?.setActiveRepo(folderPath);
                    await this.quickCommitAll(folderPath);
                })();
            },
        });

        const actions: [RepoAction, string][] = [
            ["push", "Push (active repo)"],
            ["pull", "Pull (active repo)"],
            ["sync", "Sync: pull then push (active repo)"],
            ["fetch", "Fetch (active repo)"],
        ];
        for (const [action, name] of actions) {
            this.addCommand({
                id: `${action}-active-repo`,
                name,
                callback: () => {
                    void (async () => {
                        const folderPath = await this.resolveTargetRepo();
                        if (folderPath !== null) await this.runRepoAction(action, folderPath);
                    })();
                },
            });
        }

        this.addCommand({
            id: "open-gitignore",
            name: "Edit .gitignore",
            callback: () => {
                void (async () => {
                    const folderPath = await this.resolveTargetRepo();
                    if (folderPath !== null) this.openGitignoreFile(folderPath);
                })();
            },
        });
    }

    // ─── File explorer context menu ─────────────────────────────────────

    private registerFileMenu(): void {
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                const filePath = file.path === "/" ? "" : file.path;

                // Folder that is itself a configured repo root
                if (file instanceof TFolder && this.repoRegistry.getRepo(filePath)) {
                    this.addRepoRootMenuItems(menu, filePath);
                    return;
                }

                const repo = this.repoRegistry.getRepoForFile(filePath);
                if (!repo) {
                    if (file instanceof TFolder) {
                        menu.addItem((item) =>
                            item
                                .setTitle("Git: add repository")
                                .setIcon("git-branch")
                                .onClick(() => this.openAddRepoModal(filePath))
                        );
                    }
                    return;
                }

                // File/folder inside a repo — path relative to repo root
                const repoRoot = repo.config.folderPath;
                const relativePath = repoRoot && filePath.startsWith(repoRoot + "/")
                    ? filePath.slice(repoRoot.length + 1)
                    : filePath;

                if (this.repoRegistry.checkExplicitlyIgnored(repoRoot, relativePath)) {
                    menu.addItem((item) =>
                        item
                            .setTitle("Git: remove from .gitignore")
                            .setIcon("eye")
                            .onClick(async () => {
                                this.repoRegistry.removeFromGitignore(repoRoot, relativePath);
                                new Notice(`Removed "${relativePath}" from .gitignore`);
                                await this.refreshViews();
                            })
                    );
                } else {
                    menu.addItem((item) =>
                        item
                            .setTitle("Git: add to .gitignore")
                            .setIcon("eye-off")
                            .onClick(async () => {
                                this.repoRegistry.addToGitignore(repoRoot, relativePath);
                                new Notice(`Added "${relativePath}" to .gitignore`);
                                await this.refreshViews();
                            })
                    );
                }
            })
        );
    }

    private addRepoRootMenuItems(menu: Menu, folderPath: string): void {
        menu.addItem((item) =>
            item
                .setTitle("Git: open source control")
                .setIcon("git-branch")
                .onClick(async () => {
                    await this.activateSourceControlView();
                    await this.getSourceControlView()?.setActiveRepo(folderPath);
                })
        );

        menu.addItem((item) =>
            item
                .setTitle("Git: open history")
                .setIcon("history")
                .onClick(() => this.openHistory(folderPath))
        );

        menu.addItem((item) =>
            item
                .setTitle("Git: pull")
                .setIcon("download")
                .onClick(() => this.runRepoAction("pull", folderPath))
        );

        menu.addItem((item) =>
            item
                .setTitle("Git: push")
                .setIcon("upload")
                .onClick(() => this.runRepoAction("push", folderPath))
        );

        menu.addItem((item) =>
            item
                .setTitle("Git: edit .gitignore")
                .setIcon("file-code")
                .onClick(() => this.openGitignoreFile(folderPath))
        );
    }

    // ─── Settings ───────────────────────────────────────────────────────

    async loadSettings(): Promise<void> {
        const data = ((await this.loadData()) ?? {}) as Partial<PluginSettings>;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

        // Fill in fields added in newer versions and migrate renamed ones
        type LegacyRepoConfig = Partial<FolderRepoConfig> & { githubRepoName?: string; folderPath: string };
        this.settings.repos = (data.repos ?? []).map((raw) => {
            const legacy = raw as LegacyRepoConfig;
            const { githubRepoName, ...rest } = legacy;
            const repo: FolderRepoConfig = { ...DEFAULT_REPO_CONFIG, ...rest };
            if (githubRepoName && !repo.remoteRepoName) {
                repo.remoteRepoName = githubRepoName;
                repo.hostingProvider = "github";
            }
            return repo;
        });
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    async activateSourceControlView(): Promise<void> {
        await this.activateView(SOURCE_CONTROL_VIEW_TYPE);
    }

    async activateHistoryView(): Promise<void> {
        await this.activateView(HISTORY_VIEW_TYPE);
    }

    private async activateView(type: string): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(type);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        const leaf = this.app.workspace.getLeftLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type, active: true });
            await this.app.workspace.revealLeaf(leaf);
        }
    }

    async openHistory(folderPath: string): Promise<void> {
        await this.activateHistoryView();
        await this.getHistoryView()?.setActiveRepo(folderPath);
    }

    private getSourceControlView(): SourceControlView | null {
        const leaves = this.app.workspace.getLeavesOfType(SOURCE_CONTROL_VIEW_TYPE);
        const view = leaves[0]?.view;
        return view instanceof SourceControlView ? view : null;
    }

    private getHistoryView(): HistoryView | null {
        const leaves = this.app.workspace.getLeavesOfType(HISTORY_VIEW_TYPE);
        const view = leaves[0]?.view;
        return view instanceof HistoryView ? view : null;
    }

    /** Refresh the badge and any open views */
    async refreshViews(): Promise<void> {
        await this.updateBadge();
        await this.getSourceControlView()?.render();
    }

    // ─── Repo selection & actions ───────────────────────────────────────

    /**
     * Determine which repo a command should act on:
     * the active file's repo → the repo open in source control → the only repo → ask.
     * Returns null if there are no repos or the user cancelled.
     */
    async resolveTargetRepo(): Promise<string | null> {
        const paths = this.repoRegistry.getAllPaths();
        if (paths.length === 0) {
            new Notice("No repositories configured.");
            return null;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const repo = this.repoRegistry.getRepoForFile(activeFile.path);
            if (repo) return repo.config.folderPath;
        }

        const viewRepo = this.getSourceControlView()?.currentFolderPath;
        if (viewRepo !== undefined && paths.includes(viewRepo)) return viewRepo;

        if (paths.length === 1) return paths[0];
        return pickRepo(this.app, paths);
    }

    /** Run a network action on a repo with progress/result notices */
    async runRepoAction(action: RepoAction, folderPath: string): Promise<boolean> {
        const labels = ACTION_LABELS[action];
        const repoLabel = folderPath || "vault root";
        const progress = new Notice(`${labels.running} (${repoLabel})`, 0);
        try {
            await this.repoRegistry[action](folderPath);
            new Notice(`${labels.done} (${repoLabel})`);
            return true;
        } catch (e) {
            new Notice(`${labels.failed} (${repoLabel}): ${(e as Error).message}`, 8000);
            return false;
        } finally {
            progress.hide();
            await this.refreshViews();
        }
    }

    /** Stage everything, commit with the template message and optionally push */
    async quickCommitAll(folderPath: string): Promise<void> {
        const repo = this.repoRegistry.getRepo(folderPath);
        if (!repo) return;
        try {
            const committed = await this.repoRegistry.commitAll(
                folderPath,
                renderCommitMessage(repo.config.commitMessageTemplate)
            );
            if (!committed) {
                new Notice("Nothing to commit.");
                return;
            }
            new Notice(`Committed all changes to "${folderPath || "vault root"}"`);
        } catch (e) {
            new Notice(`Commit failed: ${(e as Error).message}`);
            return;
        } finally {
            await this.refreshViews();
        }
        if (repo.config.autoPush) {
            await this.runRepoAction("push", folderPath);
        }
    }

    // ─── Modals ─────────────────────────────────────────────────────────

    openAddRepoModal(initialFolderPath?: string, onDone?: () => void): void {
        new AddRepoModal(this.app, this, () => {
            void this.refreshViews();
            onDone?.();
        }, initialFolderPath).open();
    }

    openDiffModal(filePath: string, diffContent: string): void {
        new DiffModal(this.app, filePath, diffContent).open();
    }

    openGitignoreFile(folderPath: string): void {
        if (!this.repoRegistry.getRepo(folderPath)) {
            new Notice("No repository found.");
            return;
        }
        new GitignoreModal(this.app, this.repoRegistry, folderPath, () => {
            void this.refreshViews();
        }).open();
    }

    // ─── Auto-refresh ───────────────────────────────────────────────────

    startRefreshTimer(): void {
        this.stopRefreshTimer();
        if (this.settings.refreshInterval > 0) {
            this.refreshTimer = window.setInterval(() => {
                void this.refreshViews();
            }, this.settings.refreshInterval * 1000);
        }
    }

    stopRefreshTimer(): void {
        if (this.refreshTimer !== null) {
            window.clearInterval(this.refreshTimer);
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

        const results: (RepoStatus | null)[] = await Promise.all(
            // Repos that error are skipped
            paths.map((p) => this.repoRegistry.getStatus(p).catch(() => null))
        );
        results.forEach((status, i) => {
            if (!status) return;
            newStatuses.set(paths[i], status);
            totalChanges += status.staged.length + status.changed.length + status.untracked.length + status.conflicted.length;
        });

        this.cachedStatuses = newStatuses;

        if (!this.ribbonIconEl) return;

        this.ribbonIconEl.querySelector(".folder-git-badge")?.remove();

        if (totalChanges > 0) {
            const badge = this.ribbonIconEl.createSpan({ cls: "folder-git-badge" });
            badge.setText(totalChanges > 99 ? "99+" : String(totalChanges));
        }
    }

    /** Get cached statuses (from last poll) for all repos */
    getCachedStatuses(): Map<string, RepoStatus> {
        return this.cachedStatuses;
    }
}
