import { ItemView, WorkspaceLeaf, Notice, setIcon, Menu, Platform } from "obsidian";
import {
    SOURCE_CONTROL_VIEW_TYPE,
    renderCommitMessage,
    type RepoAction,
    type RepoStatus,
    type FileStatusResult,
    type FolderGitPluginInterface,
} from "../types";
import { ConfirmModal } from "../modals/confirmModal";

export class SourceControlView extends ItemView {
    plugin: FolderGitPluginInterface;
    private activeRepo: string = "";
    private status: RepoStatus | null = null;
    private statusError: string | null = null;
    private commitInput: HTMLTextAreaElement | null = null;
    /** Commit message drafts per repo — survive auto-refresh re-renders */
    private drafts: Map<string, string> = new Map();
    /** Monotonic counter so overlapping renders never both write to the DOM */
    private renderSeq = 0;
    private busyAction: RepoAction | null = null;

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
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            this.activeRepo = paths[0];
        }
        await this.render();
    }

    async onClose(): Promise<void> {
        // cleanup
    }

    /** Fetch status, then rebuild the DOM synchronously (no flicker, no interleaving) */
    async render(): Promise<void> {
        const seq = ++this.renderSeq;
        const paths = this.plugin.repoRegistry.getAllPaths();

        if (paths.length > 0 && !paths.includes(this.activeRepo)) {
            this.activeRepo = paths[0];
        }

        let status: RepoStatus | null = null;
        let error: string | null = null;
        if (paths.length > 0) {
            try {
                status = await this.plugin.repoRegistry.getStatus(this.activeRepo);
            } catch (e) {
                error = (e as Error).message;
            }
        }

        // A newer render started while we were waiting on git
        if (seq !== this.renderSeq) return;

        this.status = status;
        this.statusError = error;
        this.draw(paths);
    }

    private draw(paths: string[]): void {
        const container = this.containerEl.children[1] as HTMLElement;

        // Preserve commit input focus and cursor across re-renders
        const hadFocus = !!this.commitInput && this.commitInput.ownerDocument.activeElement === this.commitInput;
        const selStart = this.commitInput?.selectionStart ?? 0;
        const selEnd = this.commitInput?.selectionEnd ?? 0;
        const scrollTop = container.scrollTop;

        container.empty();
        container.addClass("folder-git-source-control");
        this.commitInput = null;

        this.renderHeader(container, paths);

        if (paths.length === 0) {
            this.renderEmptyState(container);
            return;
        }

        if (this.statusError !== null) {
            container.createDiv("folder-git-error").setText(`Error: ${this.statusError}`);
            return;
        }

        const status = this.status;
        if (!status) return;

        this.renderCommitArea(container);

        if (status.conflicted.length > 0) {
            this.renderConflictedSection(container, status.conflicted);
        }

        if (status.staged.length > 0) {
            this.renderFileSection(container, "Staged changes", status.staged, true);
        }

        if (status.changed.length > 0) {
            this.renderFileSection(container, "Changes", status.changed, false);
        }

        if (status.untracked.length > 0 && this.plugin.settings.showUntrackedFiles) {
            this.renderUntrackedSection(container, status.untracked);
        }

        if (
            status.staged.length === 0 &&
            status.changed.length === 0 &&
            status.untracked.length === 0 &&
            status.conflicted.length === 0
        ) {
            container.createDiv("folder-git-no-changes").setText("No changes detected.");
        }

        if (hadFocus && this.commitInput) {
            const input: HTMLTextAreaElement = this.commitInput;
            input.focus();
            input.setSelectionRange(selStart, selEnd);
        }
        container.scrollTop = scrollTop;
    }

    // ─── Header ─────────────────────────────────────────────────────────

    private renderHeader(container: HTMLElement, paths: string[]): void {
        const header = container.createDiv("folder-git-header");

        // Repo list with status indicators
        if (paths.length > 0) {
            const repoListWrap = header.createDiv("folder-git-repo-list-wrap");
            const repoList = repoListWrap.createDiv("folder-git-repo-list");

            const cachedStatuses = this.plugin.getCachedStatuses();

            for (const p of paths) {
                const repoItem = repoList.createDiv("folder-git-repo-item");
                if (p === this.activeRepo) repoItem.addClass("active");

                // Prefer the fresh status for the active repo
                const repoStatus = p === this.activeRepo && this.status ? this.status : cachedStatuses.get(p);
                const changeCount = repoStatus
                    ? repoStatus.staged.length + repoStatus.changed.length + repoStatus.untracked.length + repoStatus.conflicted.length
                    : 0;

                if (changeCount > 0) {
                    repoItem.addClass("has-changes");
                }

                const indicator = repoItem.createSpan("folder-git-repo-indicator");
                indicator.addClass(changeCount > 0 ? "folder-git-repo-indicator-changes" : "folder-git-repo-indicator-clean");

                const repoIcon = repoItem.createSpan("folder-git-repo-icon");
                setIcon(repoIcon, "folder-git-2");

                repoItem.createSpan({ cls: "folder-git-repo-name", text: p || "(vault root)" });

                if (changeCount > 0) {
                    repoItem.createSpan({ cls: "folder-git-repo-change-count", text: String(changeCount) });
                }

                repoItem.addEventListener("click", () => {
                    void this.setActiveRepo(p);
                });
            }
        }

        const headerRow = header.createDiv("folder-git-header-row");

        // Branch badge
        if (this.status) {
            const branchBadge = headerRow.createDiv("folder-git-branch-badge");
            branchBadge.setAttr(
                "aria-label",
                this.status.tracking ? `Tracking ${this.status.tracking}` : "No upstream branch — push to publish"
            );
            const branchIcon = branchBadge.createSpan("folder-git-branch-icon");
            setIcon(branchIcon, "git-branch");
            branchBadge.createSpan({ text: this.status.branch });

            if (this.status.ahead > 0 || this.status.behind > 0) {
                const syncInfo = branchBadge.createSpan("folder-git-sync-info");
                if (this.status.ahead > 0) syncInfo.createSpan({ text: `↑${this.status.ahead}` });
                if (this.status.behind > 0) syncInfo.createSpan({ text: `↓${this.status.behind}` });
            } else if (!this.status.tracking) {
                branchBadge.createSpan({ cls: "folder-git-sync-info", text: "unpublished" });
            }
        }

        if (paths.length === 0) return;

        const actions = headerRow.createDiv("folder-git-header-actions");

        this.createIconButton(actions, "refresh-cw", "Refresh", () => { void this.refresh(); });
        this.createActionButton(actions, "pull", "download", "Pull");
        this.createActionButton(actions, "push", "upload", "Push");
        this.createActionButton(actions, "sync", "refresh-ccw-dot", "Sync (pull then push)");

        this.createIconButton(actions, "more-horizontal", "More actions", (evt) => {
            const menu = new Menu();
            menu.addItem((item) =>
                item.setTitle("Fetch").setIcon("cloud-download").onClick(() => this.runAction("fetch"))
            );
            menu.addItem((item) =>
                item.setTitle("Open history").setIcon("history").onClick(() => this.plugin.openHistory(this.activeRepo))
            );
            menu.addItem((item) =>
                item.setTitle("Edit .gitignore").setIcon("file-code").onClick(() => this.plugin.openGitignoreFile(this.activeRepo))
            );
            menu.addSeparator();
            menu.addItem((item) =>
                item.setTitle("Add folder repository").setIcon("plus").onClick(() => this.plugin.openAddRepoModal())
            );
            menu.showAtMouseEvent(evt);
        });
    }

    private createIconButton(
        parent: HTMLElement,
        icon: string,
        label: string,
        onClick: (evt: MouseEvent) => void
    ): HTMLButtonElement {
        const btn = parent.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": label },
        });
        setIcon(btn, icon);
        btn.addEventListener("click", onClick);
        return btn;
    }

    private createActionButton(parent: HTMLElement, action: RepoAction, icon: string, label: string): void {
        const btn = this.createIconButton(parent, icon, label, () => { void this.runAction(action); });
        if (this.busyAction) {
            btn.disabled = true;
            if (this.busyAction === action) btn.addClass("is-busy");
        }
    }

    // ─── Commit Area ────────────────────────────────────────────────────

    private renderCommitArea(container: HTMLElement): void {
        const commitArea = container.createDiv("folder-git-commit-area");
        const repo = this.plugin.repoRegistry.getRepo(this.activeRepo);
        const modKey = Platform.isMacOS ? "Cmd" : "Ctrl";

        const input = commitArea.createEl("textarea", {
            cls: "folder-git-commit-input",
            attr: {
                placeholder: `Message (${modKey}+Enter to commit). Empty uses: ${repo?.config.commitMessageTemplate || "template"}`,
                rows: "3",
            },
        });
        input.value = this.drafts.get(this.activeRepo) ?? "";
        input.addEventListener("input", () => {
            this.drafts.set(this.activeRepo, input.value);
        });
        input.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
                evt.preventDefault();
                const hasStaged = (this.status?.staged.length ?? 0) > 0;
                void (hasStaged ? this.commitChanges() : this.commitAll());
            }
        });
        this.commitInput = input;

        const commitActions = commitArea.createDiv("folder-git-commit-actions");

        const commitBtn = commitActions.createEl("button", {
            cls: "folder-git-commit-btn",
            text: "Commit",
            attr: { "aria-label": "Commit staged changes" },
        });
        setIcon(commitBtn.createSpan({ cls: "folder-git-btn-icon" }), "check");
        commitBtn.disabled = (this.status?.staged.length ?? 0) === 0;
        commitBtn.addEventListener("click", () => { void this.commitChanges(); });

        const commitAllBtn = commitActions.createEl("button", {
            cls: "folder-git-commit-all-btn",
            text: "Commit all",
            attr: { "aria-label": "Stage all changes and commit" },
        });
        commitAllBtn.addEventListener("click", () => { void this.commitAll(); });
    }

    // ─── File Sections ──────────────────────────────────────────────────

    private renderSectionHeader(section: HTMLElement, title: string, count: number): HTMLElement {
        const sectionHeader = section.createDiv("folder-git-section-header");
        sectionHeader.createSpan({ cls: "folder-git-section-title", text: `${title} (${count})` });
        return sectionHeader.createDiv("folder-git-section-actions");
    }

    private renderFileSection(
        container: HTMLElement,
        title: string,
        files: FileStatusResult[],
        isStaged: boolean
    ): void {
        const section = container.createDiv("folder-git-section");
        const sectionActions = this.renderSectionHeader(section, title, files.length);

        if (isStaged) {
            this.createIconButton(sectionActions, "minus", "Unstage all", () => { void this.unstageAllFiles(); });
        } else {
            this.createIconButton(sectionActions, "undo", "Discard all changes", () => {
                void this.discardFiles(files);
            }).addClass("folder-git-discard-btn");
            this.createIconButton(sectionActions, "plus", "Stage all changes", () => {
                void this.stagePaths(files.map((f) => f.path), "stage");
            });
        }

        const fileList = section.createDiv("folder-git-file-list");
        for (const file of files) {
            this.renderFileItem(fileList, file, isStaged);
        }
    }

    private renderFileName(item: HTMLElement, path: string): void {
        const fileName = item.createSpan("folder-git-file-name");
        const parts = path.replace(/\/$/, "").split("/");
        const baseName = parts.pop() || path;
        const dirPath = parts.join("/");

        fileName.createSpan({ text: baseName + (path.endsWith("/") ? "/" : ""), cls: "folder-git-file-basename" });
        if (dirPath) {
            fileName.createSpan({ text: ` ${dirPath}`, cls: "folder-git-file-dir" });
        }
        item.setAttr("aria-label", path);
    }

    private renderFileItem(
        container: HTMLElement,
        file: FileStatusResult,
        isStaged: boolean
    ): void {
        const item = container.createDiv("folder-git-file-item");

        item.createSpan({
            cls: `folder-git-status-badge folder-git-status-${file.displayStatus}`,
            text: file.displayStatus,
        });

        this.renderFileName(item, file.path);

        const itemActions = item.createDiv("folder-git-file-actions");

        this.createIconButton(itemActions, "file-text", "Open file", (e) => {
            e.stopPropagation();
            this.openFile(file.vaultPath);
        });

        if (isStaged) {
            this.createIconButton(itemActions, "minus", "Unstage", (e) => {
                e.stopPropagation();
                void this.unstageFile(file);
            });
        } else {
            this.createIconButton(itemActions, "undo", "Discard changes", (e) => {
                e.stopPropagation();
                void this.discardFiles([file]);
            }).addClass("folder-git-discard-btn");

            this.createIconButton(itemActions, "plus", "Stage", (e) => {
                e.stopPropagation();
                void this.stagePaths([file.path], "stage");
            });
        }

        // Click to view diff
        item.addEventListener("click", () => {
            void this.openDiff(file, isStaged);
        });

        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            this.showFileContextMenu(e, file, isStaged);
        });
    }

    private toRepoRelative(vaultPath: string): string {
        return this.activeRepo && vaultPath.startsWith(this.activeRepo + "/")
            ? vaultPath.slice(this.activeRepo.length + 1)
            : vaultPath;
    }

    private renderUntrackedSection(container: HTMLElement, files: string[]): void {
        const section = container.createDiv("folder-git-section");
        const sectionActions = this.renderSectionHeader(section, "Untracked", files.length);

        this.createIconButton(sectionActions, "plus", "Stage all untracked", () => {
            void this.stagePaths(files.map((f) => this.toRepoRelative(f)), "stage");
        });

        const fileList = section.createDiv("folder-git-file-list");
        for (const vaultPath of files) {
            const repoRelativePath = this.toRepoRelative(vaultPath);
            const fileResult: FileStatusResult = {
                path: repoRelativePath,
                vaultPath,
                indexStatus: "?",
                workingTreeStatus: "?",
                displayStatus: "?",
            };

            const item = fileList.createDiv("folder-git-file-item");
            item.createSpan({ cls: "folder-git-status-badge folder-git-status-untracked", text: "U" })
                .setAttr("aria-label", "Untracked");

            this.renderFileName(item, repoRelativePath);

            const itemActions = item.createDiv("folder-git-file-actions");
            this.createIconButton(itemActions, "eye-off", "Add to .gitignore", (e) => {
                e.stopPropagation();
                this.ignoreFile(fileResult);
            });
            this.createIconButton(itemActions, "plus", "Stage", (e) => {
                e.stopPropagation();
                void this.stagePaths([repoRelativePath], "stage");
            });

            item.addEventListener("click", () => this.openFile(vaultPath));

            item.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                this.showFileContextMenu(e, fileResult, false);
            });
        }
    }

    private renderConflictedSection(container: HTMLElement, files: string[]): void {
        const section = container.createDiv("folder-git-section folder-git-conflicted");
        const sectionActions = this.renderSectionHeader(section, "⚠ Merge conflicts", files.length);

        this.createIconButton(sectionActions, "check-check", "Mark all as resolved", () => {
            void this.stagePaths(files.map((f) => this.toRepoRelative(f)), "resolve");
        });

        const fileList = section.createDiv("folder-git-file-list");
        for (const vaultPath of files) {
            const repoRelativePath = this.toRepoRelative(vaultPath);
            const item = fileList.createDiv("folder-git-file-item");
            item.createSpan({ cls: "folder-git-status-badge folder-git-status-U", text: "!" });
            this.renderFileName(item, repoRelativePath);

            const itemActions = item.createDiv("folder-git-file-actions");
            this.createIconButton(itemActions, "check", "Mark as resolved (stage)", (e) => {
                e.stopPropagation();
                void this.stagePaths([repoRelativePath], "resolve");
            });

            item.addEventListener("click", () => this.openFile(vaultPath));
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
        await this.plugin.refreshViews();
    }

    private async runAction(action: RepoAction): Promise<void> {
        if (this.busyAction) return;
        this.busyAction = action;
        await this.render();
        try {
            await this.plugin.runRepoAction(action, this.activeRepo);
        } finally {
            this.busyAction = null;
            await this.render();
        }
    }

    private async stagePaths(paths: string[], verb: "stage" | "resolve"): Promise<void> {
        try {
            await this.plugin.repoRegistry.stage(this.activeRepo, paths);
        } catch (e) {
            new Notice(`Failed to ${verb}: ${(e as Error).message}`);
        }
        await this.refresh();
    }

    private async unstageFile(file: FileStatusResult): Promise<void> {
        try {
            await this.plugin.repoRegistry.unstage(this.activeRepo, [file.path]);
        } catch (e) {
            new Notice(`Failed to unstage: ${(e as Error).message}`);
        }
        await this.refresh();
    }

    private async discardFiles(files: FileStatusResult[]): Promise<void> {
        const what = files.length === 1 ? `"${files[0].path}"` : `${files.length} files`;
        const ok = await new ConfirmModal(
            this.app,
            `Discard changes to ${what}? This cannot be undone.`,
            "Discard"
        ).ask();
        if (!ok) return;

        try {
            for (const file of files) {
                await this.plugin.repoRegistry.discard(this.activeRepo, file.path);
            }
            new Notice(`Discarded changes to ${what}`);
        } catch (e) {
            new Notice(`Failed to discard: ${(e as Error).message}`);
        }
        await this.refresh();
    }

    private async unstageAllFiles(): Promise<void> {
        try {
            await this.plugin.repoRegistry.unstageAll(this.activeRepo);
        } catch (e) {
            new Notice(`Failed to unstage all: ${(e as Error).message}`);
        }
        await this.refresh();
    }

    /** Message from the input, or the repo's template when left empty */
    private getCommitMessage(): string {
        const typed = this.commitInput?.value?.trim();
        if (typed) return typed;
        const repo = this.plugin.repoRegistry.getRepo(this.activeRepo);
        return renderCommitMessage(repo?.config.commitMessageTemplate ?? "");
    }

    private clearDraft(): void {
        this.drafts.delete(this.activeRepo);
        if (this.commitInput) this.commitInput.value = "";
    }

    private async commitChanges(): Promise<void> {
        const folderPath = this.activeRepo;
        try {
            await this.plugin.repoRegistry.commit(folderPath, this.getCommitMessage());
            this.clearDraft();
            new Notice(`Committed to "${folderPath || "vault root"}"`);
        } catch (e) {
            new Notice(`Commit failed: ${(e as Error).message}`);
            return;
        }
        await this.afterCommit(folderPath);
    }

    private async commitAll(): Promise<void> {
        const folderPath = this.activeRepo;
        try {
            const committed = await this.plugin.repoRegistry.commitAll(folderPath, this.getCommitMessage());
            if (!committed) {
                new Notice("Nothing to commit.");
                return;
            }
            this.clearDraft();
            new Notice(`Committed all changes to "${folderPath || "vault root"}"`);
        } catch (e) {
            new Notice(`Commit all failed: ${(e as Error).message}`);
            return;
        }
        await this.afterCommit(folderPath);
    }

    private async afterCommit(folderPath: string): Promise<void> {
        const repo = this.plugin.repoRegistry.getRepo(folderPath);
        if (repo?.config.autoPush && repo.config.remoteUrl) {
            await this.plugin.runRepoAction("push", folderPath);
        } else {
            await this.refresh();
        }
    }

    private openFile(vaultPath: string): void {
        const target = vaultPath.replace(/\/$/, "");
        if (this.app.vault.getAbstractFileByPath(target)) {
            void this.app.workspace.openLinkText(target, "", false);
        } else {
            new Notice("File is not available in the vault (deleted, hidden or ignored by Obsidian).");
        }
    }

    private ignoreFile(file: FileStatusResult): void {
        try {
            this.plugin.repoRegistry.addToGitignore(this.activeRepo, file.path);
            new Notice(`Added "${file.path}" to .gitignore`);
        } catch (e) {
            new Notice(`Failed to add to .gitignore: ${(e as Error).message}`);
        }
        void this.refresh();
    }

    private async openDiff(file: FileStatusResult, staged: boolean): Promise<void> {
        try {
            const diff = await this.plugin.repoRegistry.getDiff(this.activeRepo, file.path, staged);
            this.plugin.openDiffModal(file.path, diff);
        } catch (e) {
            new Notice(`Failed to load diff: ${(e as Error).message}`);
        }
    }

    private showFileContextMenu(evt: MouseEvent, file: FileStatusResult, isStaged: boolean): void {
        const menu = new Menu();
        const isUntracked = file.displayStatus === "?";

        if (!isUntracked) {
            menu.addItem((item) =>
                item.setTitle("View diff").setIcon("file-diff").onClick(() => this.openDiff(file, isStaged))
            );
        }

        if (isStaged) {
            menu.addItem((item) =>
                item.setTitle("Unstage file").setIcon("minus").onClick(() => this.unstageFile(file))
            );
        } else {
            menu.addItem((item) =>
                item.setTitle("Stage file").setIcon("plus").onClick(() => this.stagePaths([file.path], "stage"))
            );

            if (isUntracked) {
                menu.addItem((item) =>
                    item.setTitle("Add to .gitignore").setIcon("eye-off").onClick(() => this.ignoreFile(file))
                );
            } else {
                menu.addItem((item) =>
                    item.setTitle("Discard changes").setIcon("undo").onClick(() => this.discardFiles([file]))
                );
            }
        }

        menu.addItem((item) =>
            item.setTitle("Open file").setIcon("file-text").onClick(() => this.openFile(file.vaultPath))
        );

        menu.showAtMouseEvent(evt);
    }

    /** Focus the commit message input (used by the commit command) */
    focusCommitInput(): void {
        this.commitInput?.focus();
    }

    /** Programmatically set the active repo and refresh */
    async setActiveRepo(folderPath: string): Promise<void> {
        this.activeRepo = folderPath;
        await this.render();
    }
}
