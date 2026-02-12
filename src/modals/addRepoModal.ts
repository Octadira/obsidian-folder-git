import { Modal, App, Setting, Notice, TFolder, FileSystemAdapter } from "obsidian";
import { DEFAULT_REPO_CONFIG, type FolderRepoConfig, type PluginSettings } from "../types";
import type { RepoRegistry } from "../repoRegistry";
import { GitHubService } from "../githubService";

/** Minimal interface to avoid circular import with main.ts */
interface FolderGitPluginRef {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    saveSettings(): Promise<void>;
}

type RepoMode = "existing" | "init" | "clone";

/**
 * Modal for adding a new folder repository.
 * Supports: existing repo, git init (with optional GitHub repo creation), clone.
 */
export class AddRepoModal extends Modal {
    private plugin: FolderGitPluginRef;
    private folderPath: string = "";
    private mode: RepoMode = "existing";
    private remoteUrl: string = "";
    private cloneUrl: string = "";
    private createGithubRepo: boolean = false;
    private githubRepoName: string = "";
    private isPrivate: boolean = true;
    private onDone: () => void;

    constructor(app: App, plugin: FolderGitPluginRef, onDone: () => void, initialFolderPath?: string) {
        super(app);
        this.plugin = plugin;
        this.onDone = onDone;
        if (initialFolderPath !== undefined) {
            this.folderPath = initialFolderPath;
            this.githubRepoName = initialFolderPath.split("/").pop() || initialFolderPath || "obsidian-vault";
        }
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Add Folder Repository" });

        // Folder selector
        new Setting(contentEl)
            .setName("Folder")
            .setDesc("Select the folder to track with Git.")
            .addDropdown((dropdown) => {
                const folders = this.getAllFolders();
                dropdown.addOption("", "(vault root)");
                for (const f of folders) {
                    if (f !== "") dropdown.addOption(f, f);
                }
                dropdown.setValue(this.folderPath);
                dropdown.onChange((value) => {
                    this.folderPath = value;
                    // Auto-fill GitHub repo name from folder name
                    if (value) {
                        this.githubRepoName = value.split("/").pop() || value;
                    } else {
                        this.githubRepoName = "obsidian-vault";
                    }
                    this.rerender();
                });
            });

        // Mode selector
        new Setting(contentEl)
            .setName("Mode")
            .addDropdown((dropdown) => {
                dropdown.addOption("existing", "Use existing repo");
                dropdown.addOption("init", "Initialize new repo");
                dropdown.addOption("clone", "Clone from URL");
                dropdown.setValue(this.mode);
                dropdown.onChange((value) => {
                    this.mode = value as RepoMode;
                    this.rerender();
                });
            });

        // Clone URL (only for clone mode)
        if (this.mode === "clone") {
            new Setting(contentEl)
                .setName("Clone URL")
                .addText((text) =>
                    text
                        .setPlaceholder("https://github.com/user/repo.git")
                        .setValue(this.cloneUrl)
                        .onChange((value) => (this.cloneUrl = value))
                );
        }

        // Remote URL (for existing and init modes, not clone)
        if (this.mode !== "clone") {
            const remoteSetting = new Setting(contentEl)
                .setName("Remote URL")
                .setDesc("Optional. Will be auto-filled if creating a GitHub repo.");

            remoteSetting.addText((text) =>
                text
                    .setPlaceholder("https://github.com/user/repo.git")
                    .setValue(this.remoteUrl)
                    .onChange((value) => (this.remoteUrl = value))
            );

            // Show detected remote for existing repos
            if (this.mode === "existing" && this.folderPath !== undefined) {
                this.detectAndShowRemote(contentEl);
            }
        }

        // ── GitHub Integration (for init mode) ──────────────────────────
        const hasToken = !!this.plugin.settings.githubToken && !!this.plugin.settings.githubUsername;

        if (this.mode === "init") {
            new Setting(contentEl)
                .setName("Create GitHub repository")
                .setDesc(
                    hasToken
                        ? `Will create repo under ${this.plugin.settings.githubUsername}'s account.`
                        : "⚠️ Configure GitHub token in settings first."
                )
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.createGithubRepo)
                        .setDisabled(!hasToken)
                        .onChange((value) => {
                            this.createGithubRepo = value;
                            this.rerender();
                        });
                });

            if (this.createGithubRepo && hasToken) {
                new Setting(contentEl)
                    .setName("Repository name")
                    .addText((text) =>
                        text
                            .setValue(this.githubRepoName)
                            .setPlaceholder("my-repo")
                            .onChange((value) => (this.githubRepoName = value.trim()))
                    );

                new Setting(contentEl)
                    .setName("Visibility")
                    .addDropdown((dropdown) => {
                        dropdown.addOption("private", "🔒 Private");
                        dropdown.addOption("public", "🌐 Public");
                        dropdown.setValue(this.isPrivate ? "private" : "public");
                        dropdown.onChange((value) => {
                            this.isPrivate = value === "private";
                        });
                    });
            }
        }

        // Add button
        new Setting(contentEl).addButton((btn) => {
            btn.setButtonText("Add Repository")
                .setCta()
                .onClick(() => this.handleAdd());
        });
    }

    private rerender(): void {
        this.onOpen();
    }

    private async detectAndShowRemote(contentEl: HTMLElement): Promise<void> {
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const absolutePath = this.folderPath
                ? `${adapter.getBasePath()}/${this.folderPath}`
                : adapter.getBasePath();

            const remotes = await this.plugin.repoRegistry.detectRemotesFromPath(absolutePath);
            if (remotes.length > 0) {
                const origin = remotes.find((r) => r.name === "origin") || remotes[0];
                if (origin && origin.fetchUrl && !this.remoteUrl) {
                    this.remoteUrl = origin.fetchUrl;
                    // Update the text field
                    const inputs = contentEl.querySelectorAll("input[type='text']");
                    inputs.forEach((input) => {
                        const el = input as HTMLInputElement;
                        if (el.placeholder.includes("github.com")) {
                            el.value = origin.fetchUrl;
                        }
                    });

                    const info = contentEl.createEl("p", {
                        text: `ℹ️ Detected remote: ${origin.name} → ${origin.fetchUrl}`,
                        cls: "setting-item-description",
                    });
                    info.style.color = "var(--text-success)";
                    info.style.marginTop = "-8px";
                    info.style.marginBottom = "12px";
                }
            }
        } catch {
            // Silently ignore detection failures
        }
    }

    private getAllFolders(): string[] {
        const folders: string[] = [];
        const recurse = (folder: TFolder) => {
            folders.push(folder.path);
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    if (
                        child.name.startsWith(".") &&
                        (child.name === ".obsidian" || child.name === ".git")
                    ) {
                        continue;
                    }
                    recurse(child);
                }
            }
        };

        const root = this.app.vault.getRoot();
        folders.push("");
        for (const child of root.children) {
            if (child instanceof TFolder) {
                if (
                    child.name.startsWith(".") &&
                    (child.name === ".obsidian" || child.name === ".git")
                ) {
                    continue;
                }
                recurse(child);
            }
        }
        return folders;
    }

    private async handleAdd(): Promise<void> {
        if (!this.folderPath && this.folderPath !== "") {
            new Notice("Please select a folder.");
            return;
        }

        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const absolutePath = this.folderPath
                ? `${adapter.getBasePath()}/${this.folderPath}`
                : adapter.getBasePath();

            // Handle mode
            if (this.mode === "init") {
                await this.plugin.repoRegistry.initRepo(absolutePath);
                new Notice(`Initialized new Git repo in "${this.folderPath || "vault root"}"`);
            } else if (this.mode === "clone") {
                if (!this.cloneUrl) {
                    new Notice("Please enter a clone URL.");
                    return;
                }
                await this.plugin.repoRegistry.cloneRepo(this.cloneUrl, absolutePath);
                new Notice(`Cloned repo into "${this.folderPath || "vault root"}"`);
            }

            // Create GitHub repo if requested
            let githubRemoteUrl = "";
            if (this.mode === "init" && this.createGithubRepo && this.githubRepoName) {
                const token = this.plugin.settings.githubToken;
                if (!token) {
                    new Notice("GitHub token not configured. Skipping repo creation.");
                } else {
                    new Notice("Creating GitHub repository...");
                    const gh = new GitHubService(token);
                    const repo = await gh.createRepo(this.githubRepoName, this.isPrivate);
                    githubRemoteUrl = repo.clone_url; // HTTPS URL
                    new Notice(`✅ Created GitHub repo: ${repo.full_name}`);
                }
            }

            // Determine final remote URL
            const finalRemoteUrl = githubRemoteUrl || (this.mode === "clone" ? this.cloneUrl : this.remoteUrl);

            // Create config
            const config: FolderRepoConfig = {
                ...DEFAULT_REPO_CONFIG,
                folderPath: this.folderPath,
                remoteUrl: finalRemoteUrl,
                autoPush: !!githubRemoteUrl, // Auto-enable push for GitHub repos
                githubRepoName: this.githubRepoName,
                isPrivate: this.isPrivate,
            };

            // Add to registry
            await this.plugin.repoRegistry.addRepo(config);

            // Add remote if specified and mode is "init" or "existing"
            if (finalRemoteUrl && this.mode !== "clone") {
                try {
                    await this.plugin.repoRegistry.addRemote(
                        this.folderPath,
                        "origin",
                        finalRemoteUrl
                    );
                } catch {
                    // Remote might already exist, that's ok
                }
            }

            // Configure credentials if we have a GitHub token and HTTPS remote
            if (this.plugin.settings.githubToken && finalRemoteUrl.startsWith("https://")) {
                await this.plugin.repoRegistry.configureCredentials(this.folderPath);
            }

            // Save settings
            this.plugin.settings.repos.push(config);
            await this.plugin.saveSettings();

            new Notice(`Added repo for "${this.folderPath || "vault root"}"`);
            this.close();
            this.onDone();
        } catch (e) {
            new Notice(`Failed: ${(e as Error).message}`);
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
