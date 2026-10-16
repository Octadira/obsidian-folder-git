import { ItemView, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import type FolderGitPlugin from "../main";
import { HISTORY_VIEW_TYPE, type GitLogEntry } from "../types";
import { ConfirmModal } from "../modals/confirmModal";

const PAGE_SIZE = 50;

export class HistoryView extends ItemView {
    plugin: FolderGitPlugin;
    private activeRepo: string = "";
    /** Repo-relative file the history is limited to ("" = whole repository) */
    private fileFilter: string = "";
    private entries: GitLogEntry[] = [];
    private hasMore = false;
    private loadError: string | null = null;
    private expandedCommits: Set<string> = new Set();
    /** Monotonic counter so a slow load never overwrites a newer one */
    private loadSeq = 0;

    constructor(leaf: WorkspaceLeaf, plugin: FolderGitPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return HISTORY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Git history";
    }

    getIcon(): string {
        return "history";
    }

    async onOpen(): Promise<void> {
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            this.activeRepo = paths[0];
        }
        await this.reload();
    }

    async onClose(): Promise<void> { }

    /** Fetch the first page of the log, then redraw */
    private async reload(): Promise<void> {
        const seq = ++this.loadSeq;
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0 && !paths.includes(this.activeRepo)) {
            this.activeRepo = paths[0];
            this.fileFilter = "";
        }

        this.entries = [];
        this.hasMore = false;
        this.loadError = null;
        if (paths.length > 0) {
            try {
                const page = await this.fetchPage(0);
                if (seq !== this.loadSeq) return;
                this.entries = page.entries;
                this.hasMore = page.hasMore;
            } catch (e) {
                if (seq !== this.loadSeq) return;
                this.loadError = (e as Error).message;
            }
        }
        this.draw();
    }

    /** Fetch and append the next page of older commits */
    private async loadMore(): Promise<void> {
        const seq = this.loadSeq;
        try {
            const page = await this.fetchPage(this.entries.length);
            if (seq !== this.loadSeq) return;
            this.entries = this.entries.concat(page.entries);
            this.hasMore = page.hasMore;
        } catch (e) {
            new Notice(`Failed to load more commits: ${(e as Error).message}`);
        }
        this.draw();
    }

    /** One page of entries; asks for one extra commit to know whether more exist */
    private async fetchPage(skip: number): Promise<{ entries: GitLogEntry[]; hasMore: boolean }> {
        const log = await this.plugin.repoRegistry.getLog(this.activeRepo, PAGE_SIZE + 1, {
            skip,
            file: this.fileFilter || undefined,
        });
        return { entries: log.slice(0, PAGE_SIZE), hasMore: log.length > PAGE_SIZE };
    }

    private draw(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        const scrollTop = container.scrollTop;
        container.empty();
        container.addClass("folder-git-history");

        this.renderHeader(container);

        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length === 0) {
            container.createDiv("folder-git-empty-state").setText("No repositories configured.");
            return;
        }

        if (this.fileFilter) this.renderFileFilter(container);

        if (this.loadError !== null) {
            container.createDiv("folder-git-error").setText(`Error: ${this.loadError}`);
            return;
        }

        if (this.entries.length === 0) {
            container
                .createDiv("folder-git-no-changes")
                .setText(this.fileFilter ? "No commits touch this file." : "No commits yet.");
            return;
        }

        const list = container.createDiv("folder-git-commit-list");
        for (const entry of this.entries) {
            this.renderCommitItem(list, entry);
        }

        if (this.hasMore) {
            const more = container.createEl("button", {
                cls: "folder-git-load-more",
                text: "Load older commits",
            });
            more.addEventListener("click", () => {
                more.disabled = true;
                void this.loadMore();
            });
        }
        container.scrollTop = scrollTop;
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv("folder-git-header");

        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            const selectorWrap = header.createDiv("folder-git-selector-wrap");
            const select = selectorWrap.createEl("select", {
                cls: "folder-git-repo-select",
            });

            for (const p of paths) {
                const opt = select.createEl("option", {
                    value: p,
                    text: p || "(vault root)",
                });
                if (p === this.activeRepo) opt.selected = true;
            }

            select.addEventListener("change", () => {
                this.activeRepo = select.value;
                this.fileFilter = "";
                this.expandedCommits.clear();
                void this.reload();
            });
        }

        // Refresh
        const actions = header.createDiv("folder-git-header-actions");
        const refreshBtn = actions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Refresh" },
        });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.addEventListener("click", () => {
            void this.reload();
        });
    }

    /** Chip showing the file the history is limited to, with a button to clear it */
    private renderFileFilter(container: HTMLElement): void {
        const chip = container.createDiv("folder-git-file-filter");
        const icon = chip.createSpan("folder-git-file-filter-icon");
        setIcon(icon, "file-clock");
        chip.createSpan({ text: this.fileFilter, cls: "folder-git-file-filter-name" });
        const clear = chip.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Show history of the whole repository" },
        });
        setIcon(clear, "x");
        clear.addEventListener("click", () => {
            this.fileFilter = "";
            this.expandedCommits.clear();
            void this.reload();
        });
    }

    private renderCommitItem(container: HTMLElement, entry: GitLogEntry): void {
        const item = container.createDiv("folder-git-commit-item");
        const isExpanded = this.expandedCommits.has(entry.hash);

        // Main commit row
        const row = item.createDiv("folder-git-commit-row");

        // Toggle expand
        const expandIcon = row.createSpan("folder-git-commit-expand");
        setIcon(expandIcon, isExpanded ? "chevron-down" : "chevron-right");

        // Hash
        row.createSpan({
            text: entry.hashShort,
            cls: "folder-git-commit-hash",
        });

        // Message
        row.createSpan({
            text: entry.message,
            cls: "folder-git-commit-message",
        });

        // Meta (author + date)
        const meta = row.createDiv("folder-git-commit-meta");
        meta.createSpan({ text: entry.author, cls: "folder-git-commit-author" });
        meta.createSpan({
            text: this.formatDate(entry.date),
            cls: "folder-git-commit-date",
        });

        // Toggle expand on click (redraws from the loaded entries, no git call)
        row.addEventListener("click", () => {
            if (this.expandedCommits.has(entry.hash)) {
                this.expandedCommits.delete(entry.hash);
            } else {
                this.expandedCommits.add(entry.hash);
            }
            this.draw();
        });

        // Expanded: show files
        if (isExpanded && entry.files && entry.files.length > 0) {
            const filesContainer = item.createDiv("folder-git-commit-files");
            for (const file of entry.files) {
                const fileItem = filesContainer.createDiv("folder-git-commit-file-item");
                fileItem.setAttr("aria-label", "View changes in this commit");
                const fileIcon = fileItem.createSpan("folder-git-commit-file-icon");
                setIcon(fileIcon, "file-diff");
                fileItem.createSpan({ text: file, cls: "folder-git-commit-file-name" });
                fileItem.addEventListener("click", () => {
                    void this.openCommitFileDiff(entry, file);
                });

                const restoreBtn = fileItem.createEl("button", {
                    cls: "folder-git-icon-btn folder-git-commit-file-restore",
                    attr: { "aria-label": "Restore this version" },
                });
                setIcon(restoreBtn, "rotate-ccw");
                restoreBtn.addEventListener("click", (evt) => {
                    evt.stopPropagation();
                    void this.restoreFile(entry, file);
                });
            }
        }
    }

    /** `git log --stat` shows renames as "old => new"; the commit's version lives at the new path */
    private resolveStatPath(file: string): string {
        return file.includes(" => ")
            ? file.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/^.* => /, "").replace(/\/\//g, "/")
            : file;
    }

    private async openCommitFileDiff(entry: GitLogEntry, file: string): Promise<void> {
        const path = this.resolveStatPath(file);
        try {
            const diff = await this.plugin.repoRegistry.getCommitFileDiff(this.activeRepo, entry.hash, path);
            this.plugin.openDiffModal(`${path} @ ${entry.hashShort}`, diff);
        } catch (e) {
            new Notice(`Failed to load diff: ${(e as Error).message}`);
        }
    }

    /** Overwrite the working copy of a file with its version in `entry` (after confirmation) */
    private async restoreFile(entry: GitLogEntry, file: string): Promise<void> {
        const path = this.resolveStatPath(file);
        const confirmed = await new ConfirmModal(
            this.app,
            `Replace "${path}" with its version from commit ${entry.hashShort}? ` +
            "Unsaved or uncommitted changes to this file will be lost. " +
            "The restored file is left unstaged so you can review it before committing.",
            "Restore"
        ).ask();
        if (!confirmed) return;

        try {
            await this.plugin.repoRegistry.restoreFile(this.activeRepo, entry.hash, path);
            new Notice(`Restored "${path}" from ${entry.hashShort}.`);
        } catch (e) {
            new Notice(`Restore failed: ${(e as Error).message}`);
        }
        await this.plugin.refreshViews();
    }

    private formatDate(dateStr: string): string {
        try {
            const d = new Date(dateStr);
            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return "just now";
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            return d.toLocaleDateString();
        } catch {
            return dateStr;
        }
    }

    /** Show a repo's history, optionally limited to one file (path relative to the repo root) */
    async setActiveRepo(folderPath: string, file?: string): Promise<void> {
        this.activeRepo = folderPath;
        this.fileFilter = file ?? "";
        this.expandedCommits.clear();
        await this.reload();
    }
}
