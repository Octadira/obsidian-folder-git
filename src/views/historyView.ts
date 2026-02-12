import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type FolderGitPlugin from "../main";
import { HISTORY_VIEW_TYPE, type GitLogEntry } from "../types";

export class HistoryView extends ItemView {
    plugin: FolderGitPlugin;
    private activeRepo: string = "";
    private entries: GitLogEntry[] = [];
    private expandedCommits: Set<string> = new Set();

    constructor(leaf: WorkspaceLeaf, plugin: FolderGitPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return HISTORY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Git History";
    }

    getIcon(): string {
        return "history";
    }

    async onOpen(): Promise<void> {
        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length > 0) {
            this.activeRepo = paths[0];
        }
        await this.loadAndRender();
    }

    async onClose(): Promise<void> { }

    private async loadAndRender(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("folder-git-history");

        // Header with repo selector
        this.renderHeader(container);

        const paths = this.plugin.repoRegistry.getAllPaths();
        if (paths.length === 0) {
            container.createDiv("folder-git-empty-state").setText("No repositories configured.");
            return;
        }

        // Load log
        try {
            this.entries = await this.plugin.repoRegistry.getLog(this.activeRepo, 50);
        } catch (e) {
            container
                .createDiv("folder-git-error")
                .setText(`Error: ${(e as Error).message}`);
            return;
        }

        if (this.entries.length === 0) {
            container.createDiv("folder-git-no-changes").setText("No commits yet.");
            return;
        }

        // Commit list
        const list = container.createDiv("folder-git-commit-list");
        for (const entry of this.entries) {
            this.renderCommitItem(list, entry);
        }
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

            select.addEventListener("change", async () => {
                this.activeRepo = select.value;
                this.expandedCommits.clear();
                await this.loadAndRender();
            });
        }

        // Refresh
        const actions = header.createDiv("folder-git-header-actions");
        const refreshBtn = actions.createEl("button", {
            cls: "folder-git-icon-btn",
            attr: { "aria-label": "Refresh" },
        });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.addEventListener("click", () => this.loadAndRender());
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

        // Toggle expand on click
        row.addEventListener("click", () => {
            if (this.expandedCommits.has(entry.hash)) {
                this.expandedCommits.delete(entry.hash);
            } else {
                this.expandedCommits.add(entry.hash);
            }
            this.loadAndRender();
        });

        // Expanded: show files
        if (isExpanded && entry.files && entry.files.length > 0) {
            const filesContainer = item.createDiv("folder-git-commit-files");
            for (const file of entry.files) {
                const fileItem = filesContainer.createDiv("folder-git-commit-file-item");
                const fileIcon = fileItem.createSpan("folder-git-commit-file-icon");
                setIcon(fileIcon, "file-text");
                fileItem.createSpan({ text: file, cls: "folder-git-commit-file-name" });
            }
        }
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

    async setActiveRepo(folderPath: string): Promise<void> {
        this.activeRepo = folderPath;
        this.expandedCommits.clear();
        await this.loadAndRender();
    }
}
