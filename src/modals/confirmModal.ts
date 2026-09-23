import { Modal, App, Setting } from "obsidian";

/** Simple yes/no confirmation dialog. Resolves true when confirmed. */
export class ConfirmModal extends Modal {
    private message: string;
    private confirmText: string;
    private resolve: (value: boolean) => void = () => { };
    private confirmed = false;

    constructor(app: App, message: string, confirmText: string = "Confirm") {
        super(app);
        this.message = message;
        this.confirmText = confirmText;
    }

    /** Open the dialog and wait for the user's answer */
    ask(): Promise<boolean> {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.open();
        });
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("p", { text: this.message });

        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => this.close())
            )
            .addButton((btn) =>
                btn
                    .setButtonText(this.confirmText)
                    .setWarning()
                    .onClick(() => {
                        this.confirmed = true;
                        this.close();
                    })
            );
    }

    onClose(): void {
        this.contentEl.empty();
        this.resolve(this.confirmed);
    }
}
