import { ItemView, WorkspaceLeaf, Notice, setIcon, Menu } from "obsidian";
import {
    SOURCE_CONTROL_VIEW_TYPE,
    type RepoStatus,
    type FileStatusResult,
    type FolderGitPluginInterface,
} from "../types";

export class SourceControlView extends ItemView {
    plugin: FolderGitPluginInterface;
    private activeRepo: string = "";
    private status: RepoStatus | null = null;
    private commitInput: HTMLTextAreaElement | null = null;
    private isLoading: boolean = false;

    get currentFolderPath(): string {
        return this.activeRepo;
    }

    constructor(leaf: WorkspaceLeaf, plugin: FolderGitPluginInterface) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return SOURCE_CONTROL_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Source control";
    }

    getIcon(): string {
        return "git-branch";
    }

    async onOpen(): Promise<void> {
        // Set initial active repo
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            this.activeRepo = paths[0];
        }
        await this.render();
    }

    async onClose(): Promise<void> {
        // cleanup
    }

    /** Full re-render */
    async render(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("folder-git-source-control");

        // Header area
        this.renderHeader(container);

        // Loading state
        if (this.isLoading) {
            const loadingEl = container.createDiv("folder-git-loading");
            loadingEl.setText("Loading...");
            return;
        }

        const paths = this.plugin.repoRegistry.getAllPaths();

        if (paths.length === 0) {
            this.renderEmptyState(container);
            return;
        }

        // Ensure activeRepo points to a valid repo in the registry
        if (!paths.includes(this.activeRepo)) {
            this.activeRepo = paths[0];
        }

        // Fetch status
        try {
            this.status = await this.plugin.repoRegistry.getStatus(this.activeRepo);
        } catch (e) {
            const errorEl = container.createDiv("folder-git-error");
            errorEl.setText(`Error: ${(e as Error).message}`);
            return;
        }

        const status = this.status;
        if (!status) return;

        // Commit area
        this.renderCommitArea(container);

        // Staged changes
        if (status.staged.length > 0) {
            this.renderFileSection(container, "Staged Changes", status.staged, true);
        }

        // Working tree changes
        if (status.changed.length > 0) {
            this.renderFileSection(container, "Changes", status.changed, false);
        }

        // Untracked files
        if (status.untracked.length > 0 && this.plugin.settings.showUntrackedFiles) {
            this.renderUntrackedSection(container, status.untracked);
        }

        // Conflicted files
        if (status.conflicted.length > 0) {
            this.renderConflictedSection(container, status.conflicted);
        }

        // No changes
        if (
            status.staged.length === 0 &&
            status.changed.length === 0 &&
            status.untracked.length === 0 &&
            status.conflicted.length === 0
        ) {
            const noChanges = container.createDiv("folder-git-no-changes");
            noChanges.setText("No changes detected.");
        }
    }

    // ─── Header ─────────────────────────────────────────────────────────

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv("folder-git-header");

        // Repo list with status indicators
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            const repoListWrap = header.createDiv("folder-git-repo-list-wrap");
            const repoList = repoListWrap.createDiv("folder-git-repo-list");

            const cachedStatuses = this.plugin.getCachedStatuses();

            for (const p of paths) {
                const repoItem = repoList.createDiv("folder-git-repo-item");
                if (p === this.activeRepo) repoItem.addClass("active");

                // Get this repo's change count
                const repoStatus = cachedStatuses.get(p);
                const changeCount = repoStatus
                    ? repoStatus.staged.length + repoStatus.changed.length + repoStatus.untracked.length
                    : 0;

                if (changeCount > 0) {
                    repoItem.addClass("has-changes");
                }

                // Status indicator dot
                const indicator = repoItem.createSpan("folder-git-repo-indicator");
                if (changeCount > 0) {
                    indicator.addClass("folder-git-repo-indicator-changes");
                } else {
                    indicator.addClass("folder-git-repo-indicator-clean");
                }

                // Repo icon
                const repoIcon = repoItem.createSpan("folder-git-repo-icon");
                setIcon(repoIcon, "folder-git-2");

                // Repo name
                const repoName = repoItem.createSpan("folder-git-repo-name");
                repoName.setText(p || "(vault root)");

                // Change count badge
                if (changeCount > 0) {
                    const countBadge = repoItem.createSpan("folder-git-repo-change-count");
                    countBadge.setText(String(changeCount));
                }

                repoItem.addEventListener("click", () => {
                    void (async () => {
                        this.activeRepo = p;
                        await this.render();
                    })();
                });
            }
        }

        // Branch badge + actions row
        const headerRow = header.createDiv("folder-git-header-row");

        // Branch badge
        if (this.status) {
            const branchBadge = headerRow.createDiv("folder-git-branch-badge");
            const branchIcon = branchBadge.createSpan("folder-git-branch-icon");
            setIcon(branchIcon, "git-branch");
            branchBadge.createSpan({ text: this.status.branch });

            if (this.status.ahead > 0 || this.status.behind > 0) {
                const syncInfo = branchBadge.createSpan("folder-git-sync-info");
                if (this.status.ahead > 0) syncInfo.createSpan({ text: `↑${this.status.ahead}` });
                if (this.status.behind > 0) syncInfo.createSpan({ text: `↓${this.status.behind}` });
            }
        }

        // Action buttons
        const actions = headerRow.createDiv("folder-git-header-actions");

        // Refresh button
        const refreshBtn = actions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Refresh" },
        });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.addEventListener("click", () => { void this.refresh(); });

        // Pull button
        const pullBtn = actions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Pull" },
        });
        setIcon(pullBtn, "download");
        pullBtn.addEventListener("click", () => { void this.pullRepo(); });

        // Push button
        const pushBtn = actions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Push" },
        });
        setIcon(pushBtn, "upload");
        pushBtn.addEventListener("click", () => { void this.pushRepo(); });
    }

    // ─── Commit Area ────────────────────────────────────────────────────

    private renderCommitArea(container: HTMLElement): void {
        const commitArea = container.createDiv("folder-git-commit-area");

        this.commitInput = commitArea.createEl("textarea", {
            cls: "folder-git-commit-input",
            attr: { placeholder: "Commit message...", rows: "3" },
        });

        const commitActions = commitArea.createDiv("folder-git-commit-actions");

        // Commit button
        const commitBtn = commitActions.createEl("button", {
            cls: "folder-git-commit-btn",
            text: "Commit",
        });
        setIcon(commitBtn.createSpan({ cls: "folder-git-btn-icon" }), "check");
        commitBtn.addEventListener("click", () => { void this.commitChanges(); });

        // Stage All + Commit button
        const commitAllBtn = commitActions.createEl("button", {
            cls: "folder-git-commit-all-btn",
            text: "Commit all",
        });
        commitAllBtn.addEventListener("click", () => { void this.commitAll(); });
    }

    // ─── File Sections ──────────────────────────────────────────────────

    private renderFileSection(
        container: HTMLElement,
        title: string,
        files: FileStatusResult[],
        isStaged: boolean
    ): void {
        const section = container.createDiv("folder-git-section");

        const sectionHeader = section.createDiv("folder-git-section-header");
        const titleEl = sectionHeader.createSpan("folder-git-section-title");
        titleEl.setText(`${title} (${files.length})`);

        // Section actions
        const sectionActions = sectionHeader.createDiv("folder-git-section-actions");

        if (isStaged) {
            // Unstage all
            const unstageAllBtn = sectionActions.createEl("button", {
                cls: "folder-git-icon-btn",
                attr: { "aria-label": "Unstage all" },
            });
            setIcon(unstageAllBtn, "minus");
            unstageAllBtn.addEventListener("click", () => { void this.unstageAllFiles(); });
        } else {
            // Stage all
            const stageAllBtn = sectionActions.createEl("button", {
                cls: "folder-git-icon-btn",
                attr: { "aria-label": "Stage all" },
            });
            setIcon(stageAllBtn, "plus");
            stageAllBtn.addEventListener("click", () => { void this.stageAllFiles(); });
        }

        // File list
        const fileList = section.createDiv("folder-git-file-list");
        for (const file of files) {
            this.renderFileItem(fileList, file, isStaged);
        }
    }

    private renderFileItem(
        container: HTMLElement,
        file: FileStatusResult,
        isStaged: boolean
    ): void {
        const item = container.createDiv("folder-git-file-item");

        // Status badge
        const statusBadge = item.createSpan(
            `folder-git-status-badge folder-git-status-${file.displayStatus}`
        );
        statusBadge.setText(file.displayStatus);

        // File name
        const fileName = item.createSpan("folder-git-file-name");
        const parts = file.path.split("/");
        const baseName = parts.pop() || file.path;
        const dirPath = parts.join("/");

        fileName.createSpan({ text: baseName, cls: "folder-git-file-basename" });
        if (dirPath) {
            fileName.createSpan({ text: ` ${dirPath}`, cls: "folder-git-file-dir" });
        }

        // Actions
        const itemActions = item.createDiv("folder-git-file-actions");

        // View diff
        const diffBtn = itemActions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "View diff" },
        });
        setIcon(diffBtn, "file-diff");
        diffBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.openDiff(file, isStaged);
        });

        if (isStaged) {
            // Unstage
            const unstageBtn = itemActions.createEl("button", {
                cls: "folder-git-icon-btn",
                attr: { "aria-label": "Unstage" },
            });
            setIcon(unstageBtn, "minus");
            unstageBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void this.unstageFile(file);
            });
        } else {
            // Stage
            const stageBtn = itemActions.createEl("button", {
                cls: "folder-git-icon-btn",
                attr: { "aria-label": "Stage" },
            });
            setIcon(stageBtn, "plus");
            stageBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void this.stageFile(file);
            });

            // Discard
            const discardBtn = itemActions.createEl("button", {
                cls: "folder-git-icon-btn folder-git-discard-btn",
                attr: { "aria-label": "Discard changes" },
            });
            setIcon(discardBtn, "undo");
            discardBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void this.discardFile(file);
            });
        }

        // Click to open file
        item.addEventListener("click", () => {
            void this.openDiff(file, isStaged);
        });

        // Context menu
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.showFileContextMenu(e, file, isStaged);
        });
    }

    private renderUntrackedSection(container: HTMLElement, files: string[]): void {
        const section = container.createDiv("folder-git-section");

        const sectionHeader = section.createDiv("folder-git-section-header");
        const titleEl = sectionHeader.createSpan("folder-git-section-title");
        titleEl.setText(`Untracked (${files.length})`);

        // Stage all untracked
        const sectionActions = sectionHeader.createDiv("folder-git-section-actions");
        const stageAllBtn = sectionActions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Stage all untracked" },
        });
        setIcon(stageAllBtn, "plus");
        stageAllBtn.addEventListener("click", () => { void this.stageAllFiles(); });

        const fileList = section.createDiv("folder-git-file-list");
        for (const filePath of files) {
            const item = fileList.createDiv("folder-git-file-item");

            const statusBadge = item.createSpan("folder-git-status-badge folder-git-status-\\?");
            statusBadge.setText("?");

            const fileName = item.createSpan("folder-git-file-name");
            const parts = filePath.split("/");
            const baseName = parts.pop() || filePath;
            fileName.createSpan({ text: baseName, cls: "folder-git-file-basename" });

            const itemActions = item.createDiv("folder-git-file-actions");
            const stageBtn = itemActions.createEl("button", {
                cls: "folder-git-icon-btn",
                attr: { "aria-label": "Stage" },
            });
            setIcon(stageBtn, "plus");

            // Get relative path for staging
            const repoRelativePath = this.activeRepo
                ? filePath.replace(this.activeRepo + "/", "")
                : filePath;

            stageBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                void (async () => {
                    try {
                        await this.plugin.repoRegistry.stage(this.activeRepo, [repoRelativePath]);
                        await this.refresh();
                    } catch (err) {
                        new Notice(`Failed to stage: ${(err as Error).message}`);
                    }
                })();
            });

            // Context menu for untracked files
            item.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                // Create a dummy FileStatusResult for the context menu
                const fileResult: FileStatusResult = {
                    path: repoRelativePath,
                    vaultPath: filePath,
                    indexStatus: "?",
                    workingTreeStatus: "?",
                    displayStatus: "?",
                };
                this.showFileContextMenu(e, fileResult, false);
            });
        }
    }

    private renderConflictedSection(container: HTMLElement, files: string[]): void {
        const section = container.createDiv("folder-git-section folder-git-conflicted");
        const sectionHeader = section.createDiv("folder-git-section-header");
        const titleEl = sectionHeader.createSpan("folder-git-section-title");
        titleEl.setText(`⚠ Conflicts (${files.length})`);

        const fileList = section.createDiv("folder-git-file-list");
        for (const filePath of files) {
            const item = fileList.createDiv("folder-git-file-item");
            const statusBadge = item.createSpan("folder-git-status-badge folder-git-status-U");
            statusBadge.setText("U");
            const fileName = item.createSpan("folder-git-file-name");
            fileName.createSpan({ text: filePath, cls: "folder-git-file-basename" });
        }
    }

    private renderEmptyState(container: HTMLElement): void {
        const empty = container.createDiv("folder-git-empty-state");
        empty.createEl("p", { text: "No folders configured for Git tracking." });

        const addBtn = empty.createEl("button", {
            cls: "folder-git-add-repo-btn",
            text: "Add folder repository",
        });
        addBtn.addEventListener("click", () => {
            this.plugin.openAddRepoModal();
        });
    }

    // ─── Actions ────────────────────────────────────────────────────────

    async refresh(): Promise<void> {
        this.isLoading = true;
        await this.render();
        this.isLoading = false;
        await this.render();
    }

    private async stageFile(file: FileStatusResult): Promise<void> {
        try {
            await this.plugin.repoRegistry.stage(this.activeRepo, [file.path]);
            await this.refresh();
        } catch (e) {
            new Notice(`Failed to stage: ${(e as Error).message}`);
        }
    }

    private async unstageFile(file: FileStatusResult): Promise<void> {
        try {
            await this.plugin.repoRegistry.unstage(this.activeRepo, [file.path]);
            await this.refresh();
        } catch (e) {
            new Notice(`Failed to unstage: ${(e as Error).message}`);
        }
    }

    private async discardFile(file: FileStatusResult): Promise<void> {
        try {
            await this.plugin.repoRegistry.discard(this.activeRepo, file.path);
            await this.refresh();
            new Notice(`Discarded changes: ${file.path}`);
        } catch (e) {
            new Notice(`Failed to discard: ${(e as Error).message}`);
        }
    }

    private async stageAllFiles(): Promise<void> {
        try {
            await this.plugin.repoRegistry.stageAll(this.activeRepo);
            await this.refresh();
        } catch (e) {
            new Notice(`Failed to stage all: ${(e as Error).message}`);
        }
    }

    private async unstageAllFiles(): Promise<void> {
        try {
            await this.plugin.repoRegistry.unstageAll(this.activeRepo);
            await this.refresh();
        } catch (e) {
            new Notice(`Failed to unstage all: ${(e as Error).message}`);
        }
    }

    private async commitChanges(): Promise<void> {
        const message = this.commitInput?.value?.trim();
        if (!message) {
            new Notice("Please enter a commit message.");
            return;
        }
        try {
            await this.plugin.repoRegistry.commit(this.activeRepo, message);
            if (this.commitInput) this.commitInput.value = "";
            new Notice(`Committed to "${this.activeRepo || "vault root"}"`);
        } catch (e) {
            new Notice(`Commit failed: ${(e as Error).message}`);
            return;
        }

        // Auto-push if configured (separate try/catch so commit success is preserved)
        const repo = this.plugin.repoRegistry.getRepo(this.activeRepo);
        if (repo?.config.autoPush) {
            try {
                await this.plugin.repoRegistry.push(this.activeRepo);
                new Notice("Pushed to remote.");
            } catch (e) {
                new Notice(`Commit succeeded, but push failed: ${(e as Error).message}`);
            }
        }

        await this.refresh();
    }

    private async commitAll(): Promise<void> {
        const message = this.commitInput?.value?.trim();
        if (!message) {
            new Notice("Please enter a commit message.");
            return;
        }
        try {
            await this.plugin.repoRegistry.stageAll(this.activeRepo);
            await this.plugin.repoRegistry.commit(this.activeRepo, message);
            if (this.commitInput) this.commitInput.value = "";
            new Notice(`Committed all changes to "${this.activeRepo || "vault root"}"`);
        } catch (e) {
            new Notice(`Commit all failed: ${(e as Error).message}`);
            return;
        }

        // Auto-push if configured (separate try/catch)
        const repo = this.plugin.repoRegistry.getRepo(this.activeRepo);
        if (repo?.config.autoPush) {
            try {
                await this.plugin.repoRegistry.push(this.activeRepo);
                new Notice("Pushed to remote.");
            } catch (e) {
                new Notice(`Commit succeeded, but push failed: ${(e as Error).message}`);
            }
        }

        await this.refresh();
    }

    private async pushRepo(): Promise<void> {
        try {
            await this.plugin.repoRegistry.push(this.activeRepo);
            new Notice("Push successful.");
            await this.refresh();
        } catch (e) {
            new Notice(`Push failed: ${(e as Error).message}`);
        }
    }

    private async pullRepo(): Promise<void> {
        try {
            await this.plugin.repoRegistry.pull(this.activeRepo);
            new Notice("Pull successful.");
            await this.refresh();
        } catch (e) {
            new Notice(`Pull failed: ${(e as Error).message}`);
        }
    }

    private async openDiff(file: FileStatusResult, staged: boolean): Promise<void> {
        try {
            const diff = await this.plugin.repoRegistry.getDiff(
                this.activeRepo,
                file.path,
                staged
            );
            this.plugin.openDiffModal(file.path, diff);
        } catch (e) {
            new Notice(`Failed to load diff: ${(e as Error).message}`);
        }
    }

    private showFileContextMenu(evt: MouseEvent, file: FileStatusResult, isStaged: boolean): void {
        const menu = new Menu();

        menu.addItem((item) =>
            item
                .setTitle("View diff")
                .setIcon("file-diff")
                .onClick(() => this.openDiff(file, isStaged))
        );

        if (isStaged) {
            menu.addItem((item) =>
                item
                    .setTitle("Unstage file")
                    .setIcon("minus")
                    .onClick(() => this.unstageFile(file))
            );
        } else {
            // Stage
            menu.addItem((item) =>
                item
                    .setTitle("Stage file")
                    .setIcon("plus")
                    .onClick(() => this.stageFile(file))
            );

            // Add to .gitignore (only if untracked or modified)
            // If it's untracked (?), we definitely want to allow adding to gitignore
            if (file.displayStatus === "?") {
                menu.addItem((item) =>
                    item
                        .setTitle("Add to .gitignore")
                        .setIcon("eye-off")
                        .onClick(() => {
                            void (async () => {
                                try {
                                    this.plugin.repoRegistry.addToGitignore(this.activeRepo, file.path);
                                    new Notice(`Added "${file.path}" to .gitignore`);
                                    await this.refresh();
                                } catch (e) {
                                    new Notice(`Failed to add to .gitignore: ${(e as Error).message}`);
                                }
                            })();
                        })
                );
            }


            // Allow discard for modified files (not untracked usually, but standard git allows clean)
            if (file.displayStatus !== "?") {
                menu.addItem((item) =>
                    item
                        .setTitle("Discard changes")
                        .setIcon("undo")
                        .onClick(() => this.discardFile(file))
                );
            }
        }

        menu.addItem((item) =>
            item
                .setTitle("Open file")
                .setIcon("file-text")
                .onClick(() => {
                    const tFile = this.app.vault.getAbstractFileByPath(file.vaultPath);
                    if (tFile) {
                        void this.app.workspace.openLinkText(file.vaultPath, "", false);
                    }
                })
        );

        menu.showAtMouseEvent(evt);
    }

    /** Programmatically set the active repo and refresh */
    async setActiveRepo(folderPath: string): Promise<void> {
        this.activeRepo = folderPath;
        await this.refresh();
    }
}
