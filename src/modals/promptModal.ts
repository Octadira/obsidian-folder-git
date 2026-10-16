import { App, Modal, Setting } from "obsidian";

export interface PromptOptions {
    title: string;
    description?: string;
    placeholder?: string;
    initial?: string;
    confirmText?: string;
    /** Use a multi-line text area (Enter inserts a newline; Ctrl/Cmd+Enter submits) */
    multiline?: boolean;
    /** Allow submitting an empty value */
    allowEmpty?: boolean;
}

/** Text input dialog. Resolves the trimmed text, or null when cancelled. */
class PromptModal extends Modal {
    private value: string;
    private submitted = false;
    private resolve: (value: string | null) => void = () => { };

    constructor(app: App, private options: PromptOptions) {
        super(app);
        this.value = options.initial ?? "";
    }

    ask(): Promise<string | null> {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.open();
        });
    }

    onOpen(): void {
        const { contentEl, options } = this;
        contentEl.createEl("h3", { text: options.title });
        if (options.description) contentEl.createEl("p", { text: options.description, cls: "setting-item-description" });

        const submit = (): void => {
            const text = this.value.trim();
            if (!text && !options.allowEmpty) return;
            this.submitted = true;
            this.close();
        };

        let input: HTMLInputElement | HTMLTextAreaElement;
        if (options.multiline) {
            input = contentEl.createEl("textarea", { cls: "folder-git-prompt-input", attr: { rows: "5" } });
        } else {
            input = contentEl.createEl("input", { cls: "folder-git-prompt-input", attr: { type: "text" } });
        }
        if (options.placeholder) input.placeholder = options.placeholder;
        input.value = this.value;
        input.addEventListener("input", () => { this.value = input.value; });
        input.addEventListener("keydown", (evt: KeyboardEvent) => {
            const enter = evt.key === "Enter";
            if (enter && (!options.multiline || evt.ctrlKey || evt.metaKey)) {
                evt.preventDefault();
                submit();
            }
        });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText(options.confirmText ?? "OK").setCta().onClick(submit));

        window.setTimeout(() => input.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
        this.resolve(this.submitted ? this.value.trim() : null);
    }
}

export function promptText(app: App, options: PromptOptions): Promise<string | null> {
    return new PromptModal(app, options).ask();
}
