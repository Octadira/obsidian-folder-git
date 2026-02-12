import { Modal, App } from "obsidian";

/**
 * Modal for viewing a unified diff with colored lines.
 */
export class DiffModal extends Modal {
    private filePath: string;
    private diffContent: string;

    constructor(app: App, filePath: string, diffContent: string) {
        super(app);
        this.filePath = filePath;
        this.diffContent = diffContent;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass("folder-git-diff-modal");

        // Header
        const header = contentEl.createDiv("folder-git-diff-header");
        header.createEl("h3", { text: this.filePath });

        // Diff content
        const diffContainer = contentEl.createDiv("folder-git-diff-container");

        if (!this.diffContent || this.diffContent.trim() === "") {
            diffContainer.createDiv("folder-git-diff-empty").setText(
                "No differences found (file may be newly staged or binary)."
            );
            return;
        }

        const lines = this.diffContent.split("\n");
        let lineNumOld = 0;
        let lineNumNew = 0;

        const table = diffContainer.createEl("table", {
            cls: "folder-git-diff-table",
        });

        for (const line of lines) {
            // Parse hunk headers
            const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
            if (hunkMatch) {
                lineNumOld = parseInt(hunkMatch[1], 10);
                lineNumNew = parseInt(hunkMatch[2], 10);

                const tr = table.createEl("tr", { cls: "folder-git-diff-hunk" });
                tr.createEl("td", { cls: "folder-git-diff-line-num", attr: { colspan: "2" } });
                const contentTd = tr.createEl("td", { cls: "folder-git-diff-line-content" });
                contentTd.setText(line);
                continue;
            }

            // Skip diff metadata lines
            if (
                line.startsWith("diff --git") ||
                line.startsWith("index ") ||
                line.startsWith("---") ||
                line.startsWith("+++") ||
                line.startsWith("\\")
            ) {
                continue;
            }

            const tr = table.createEl("tr");

            if (line.startsWith("+")) {
                tr.addClass("folder-git-diff-added");
                tr.createEl("td", { cls: "folder-git-diff-line-num", text: "" });
                tr.createEl("td", { cls: "folder-git-diff-line-num", text: String(lineNumNew) });
                const td = tr.createEl("td", { cls: "folder-git-diff-line-content" });
                td.setText(line.substring(1));
                lineNumNew++;
            } else if (line.startsWith("-")) {
                tr.addClass("folder-git-diff-removed");
                tr.createEl("td", { cls: "folder-git-diff-line-num", text: String(lineNumOld) });
                tr.createEl("td", { cls: "folder-git-diff-line-num", text: "" });
                const td = tr.createEl("td", { cls: "folder-git-diff-line-content" });
                td.setText(line.substring(1));
                lineNumOld++;
            } else {
                tr.addClass("folder-git-diff-context");
                tr.createEl("td", {
                    cls: "folder-git-diff-line-num",
                    text: String(lineNumOld),
                });
                tr.createEl("td", {
                    cls: "folder-git-diff-line-num",
                    text: String(lineNumNew),
                });
                const td = tr.createEl("td", { cls: "folder-git-diff-line-content" });
                td.setText(line.startsWith(" ") ? line.substring(1) : line);
                lineNumOld++;
                lineNumNew++;
            }
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
