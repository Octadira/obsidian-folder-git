import { App, FuzzySuggestModal } from "obsidian";

/** Fuzzy picker over arbitrary items. Resolves null when dismissed. */
class PickModal<T> extends FuzzySuggestModal<T> {
    private chosen = false;

    constructor(
        app: App,
        private items: T[],
        private toText: (item: T) => string,
        placeholder: string,
        private onDone: (item: T | null) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    getItems(): T[] {
        return this.items;
    }

    getItemText(item: T): string {
        return this.toText(item);
    }

    onChooseItem(item: T): void {
        this.chosen = true;
        this.onDone(item);
    }

    onClose(): void {
        super.onClose();
        // onChooseItem fires after onClose, so defer the "dismissed" check
        window.setTimeout(() => {
            if (!this.chosen) this.onDone(null);
        }, 0);
    }
}

export function pickItem<T>(app: App, items: T[], toText: (item: T) => string, placeholder: string): Promise<T | null> {
    return new Promise((resolve) => {
        new PickModal(app, items, toText, placeholder, resolve).open();
    });
}
