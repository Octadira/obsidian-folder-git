import { App, FuzzySuggestModal } from "obsidian";

/** Fuzzy picker for choosing one of the configured repositories */
export class RepoSuggestModal extends FuzzySuggestModal<string> {
    private paths: string[];
    private onChoose: (folderPath: string | null) => void;
    private chosen = false;

    constructor(app: App, paths: string[], onChoose: (folderPath: string | null) => void) {
        super(app);
        this.paths = paths;
        this.onChoose = onChoose;
        this.setPlaceholder("Choose a repository");
    }

    getItems(): string[] {
        return this.paths;
    }

    getItemText(item: string): string {
        return item || "(vault root)";
    }

    onChooseItem(item: string): void {
        this.chosen = true;
        this.onChoose(item);
    }

    onClose(): void {
        super.onClose();
        // onChooseItem fires after onClose, so defer the "cancelled" check
        activeWindow.setTimeout(() => {
            if (!this.chosen) this.onChoose(null);
        }, 0);
    }
}

/** Ask the user to pick a repository; resolves null if cancelled */
export function pickRepo(app: App, paths: string[]): Promise<string | null> {
    return new Promise((resolve) => {
        new RepoSuggestModal(app, paths, resolve).open();
    });
}
