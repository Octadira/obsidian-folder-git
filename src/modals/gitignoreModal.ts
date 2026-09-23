import { Modal, App, Setting, Notice } from "obsidian";
import type { RepoRegistry } from "../repoRegistry";

/**
 * Editor for a repo's .gitignore.
 * Obsidian does not index dotfiles, so the file cannot be opened as a regular note.
 */
export class GitignoreModal extends Modal {
    private registry: RepoRegistry;
    private folderPath: string;
    private onSaved: () => void;

    constructor(app: App, registry: RepoRegistry, folderPath: string, onSaved: () => void) {
        super(app);
        this.registry = registry;
        this.folderPath = folderPath;
        this.onSaved = onSaved;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass("folder-git-gitignore-modal");
        new Setting(contentEl).setName(`.gitignore — ${this.folderPath || "vault root"}`).setHeading();

        let content = "";
        try {
            content = this.registry.readGitignore(this.folderPath);
        } catch (e) {
            new Notice(`Could not read .gitignore: ${(e as Error).message}`);
        }

        const textarea = contentEl.createEl("textarea", {
            cls: "folder-git-gitignore-input",
            attr: { spellcheck: "false", rows: "16" },
        });
        textarea.value = content;

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((btn) =>
                btn
                    .setButtonText("Save")
                    .setCta()
                    .onClick(() => {
                        try {
                            this.registry.writeGitignore(this.folderPath, textarea.value);
                            new Notice("Saved .gitignore");
                            this.close();
                            this.onSaved();
                        } catch (e) {
                            new Notice(`Could not save .gitignore: ${(e as Error).message}`);
                        }
                    })
            );

        window.setTimeout(() => textarea.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
