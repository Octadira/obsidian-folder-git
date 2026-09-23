import { PluginSettingTab, Setting, App, Notice } from "obsidian";
import type FolderGitPlugin from "./main";
import type { FolderRepoConfig } from "./types";
import { GitHubService } from "./hosting/githubService";
import { ForgejoService } from "./hosting/forgejoService";
import { normalizeInstanceUrl, type HostingService } from "./hosting/hostingService";

export class FolderGitSettingsTab extends PluginSettingTab {
    plugin: FolderGitPlugin;

    constructor(app: App, plugin: FolderGitPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Global Settings ──────────────────────────────────────────────

        new Setting(containerEl)
            .setName("Git binary path")
            .setDesc("Custom path to Git executable. Leave empty to use system default. Takes effect after reloading the plugin.")
            .addText((text) =>
                text
                    .setPlaceholder("/usr/bin/Git")
                    .setValue(this.plugin.settings.gitBinaryPath)
                    .onChange(async (value) => {
                        this.plugin.settings.gitBinaryPath = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show untracked files")
            .setDesc("Display untracked files in the source control view.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showUntrackedFiles)
                    .onChange(async (value) => {
                        this.plugin.settings.showUntrackedFiles = value;
                        await this.plugin.saveSettings();
                        await this.plugin.refreshViews();
                    })
            );

        new Setting(containerEl)
            .setName("Status refresh interval")
            .setDesc("How often to refresh Git status (in seconds). Set to 0 to disable auto-refresh.")
            .addText((text) =>
                text
                    .setPlaceholder("30")
                    .setValue(String(this.plugin.settings.refreshInterval))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            this.plugin.settings.refreshInterval = num;
                            await this.plugin.saveSettings();
                            this.plugin.restartRefreshTimer();
                        }
                    })
            );

        // ── GitHub Authentication ────────────────────────────────────────

        new Setting(containerEl).setName("GitHub").setHeading();

        this.renderAccountStatus(containerEl, this.plugin.settings.githubUsername);

        const githubToken = new Setting(containerEl)
            .setName("Personal access token")
            .setDesc("Classic token with 'repo' scope, or a fine-grained token with contents and administration (write) permissions.");

        githubToken.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.addClass("folder-git-token-input");
            text
                .setPlaceholder("Token")
                .setValue(this.plugin.settings.githubToken)
                .onChange(async (value) => {
                    this.plugin.settings.githubToken = value.trim();
                    this.plugin.settings.githubUsername = "";
                    await this.plugin.saveSettings();
                });
        });

        githubToken.addButton((btn) => {
            btn.setButtonText("Validate")
                .setCta()
                .onClick(async () => {
                    const token = this.plugin.settings.githubToken;
                    if (!token) {
                        new Notice("Please enter a GitHub token first.");
                        return;
                    }
                    btn.setButtonText("Checking...").setDisabled(true);
                    this.plugin.settings.githubUsername = await this.validate(new GitHubService(token), "GitHub");
                    await this.plugin.saveSettings();
                    this.display();
                });
        });

        // ── Forgejo Authentication ───────────────────────────────────────

        new Setting(containerEl).setName("Forgejo").setHeading();

        containerEl.createEl("p", {
            text: "Works with any Forgejo or Gitea instance, including Codeberg.",
            cls: "setting-item-description",
        });

        this.renderAccountStatus(containerEl, this.plugin.settings.forgejoUsername);

        new Setting(containerEl)
            .setName("Instance URL")
            .setDesc("Base URL of your Forgejo server.")
            .addText((text) => {
                text.inputEl.addClass("folder-git-token-input");
                text
                    .setPlaceholder("https://codeberg.org")
                    .setValue(this.plugin.settings.forgejoUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.forgejoUrl = value.trim();
                        this.plugin.settings.forgejoUsername = "";
                        await this.plugin.saveSettings();
                    });
            });

        const forgejoToken = new Setting(containerEl)
            .setName("Access token")
            .setDesc("Create one under settings → applications, with read/write access to 'repository' and read access to 'user' (plus 'organization': read to list your organizations, read/write to create organizations).");

        forgejoToken.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.addClass("folder-git-token-input");
            text
                .setPlaceholder("Token")
                .setValue(this.plugin.settings.forgejoToken)
                .onChange(async (value) => {
                    this.plugin.settings.forgejoToken = value.trim();
                    this.plugin.settings.forgejoUsername = "";
                    await this.plugin.saveSettings();
                });
        });

        forgejoToken.addButton((btn) => {
            btn.setButtonText("Validate")
                .setCta()
                .onClick(async () => {
                    const { forgejoToken: token, forgejoUrl } = this.plugin.settings;
                    if (!token || !forgejoUrl) {
                        new Notice("Please enter the Forgejo instance URL and token first.");
                        return;
                    }
                    let baseUrl: string;
                    try {
                        baseUrl = normalizeInstanceUrl(forgejoUrl);
                    } catch (e) {
                        new Notice(`❌ ${(e as Error).message}`);
                        return;
                    }
                    if (baseUrl.startsWith("http://")) {
                        new Notice("Warning: this instance does not use HTTPS, so your token will be sent unencrypted.");
                    }
                    btn.setButtonText("Checking...").setDisabled(true);
                    this.plugin.settings.forgejoUrl = baseUrl;
                    this.plugin.settings.forgejoUsername = await this.validate(new ForgejoService(baseUrl, token), "Forgejo");
                    await this.plugin.saveSettings();
                    this.display();
                });
        });

        containerEl.createEl("p", {
            text: "Tokens are stored in this vault's plugin data and are only passed to Git through environment variables during push, pull, fetch and clone over HTTPS for the matching host. SSH remotes use your SSH keys.",
            cls: "setting-item-description",
        });

        // ── Repository List ──────────────────────────────────────────────

        new Setting(containerEl).setName("Configured repositories").setHeading();

        if (this.plugin.settings.repos.length === 0) {
            containerEl.createEl("p", {
                text: 'No repositories configured. Use the "add folder repository" command or button in the source control view.',
                cls: "setting-item-description",
            });
        }

        for (const repo of this.plugin.settings.repos) {
            this.renderRepoSettings(containerEl, repo);
        }

        // Add repo button
        new Setting(containerEl).addButton((btn) => {
            btn.setButtonText("Add folder repository")
                .setCta()
                .onClick(() => {
                    this.plugin.openAddRepoModal(undefined, () => this.display());
                });
        });
    }

    private renderAccountStatus(containerEl: HTMLElement, username: string): void {
        new Setting(containerEl)
            .setName("Account")
            .setDesc(username ? `✅ Authenticated as ${username}` : "Not connected. Enter a token and click validate.");
    }

    /** Validate a token; returns the username or "" on failure */
    private async validate(service: HostingService, label: string): Promise<string> {
        try {
            const user = await service.validateToken();
            new Notice(`✅ ${label}: authenticated as ${user.login}`);
            return user.login;
        } catch (e) {
            new Notice(`❌ ${(e as Error).message || `Invalid ${label} token.`}`);
            return "";
        }
    }

    private renderRepoSettings(containerEl: HTMLElement, repo: FolderRepoConfig): void {
        const section = containerEl.createDiv("folder-git-settings-repo");

        // Repo header with folder path
        const header = section.createDiv("folder-git-settings-repo-header");
        new Setting(header).setName(`📁 ${repo.folderPath || "(vault root)"}`).setHeading();

        const isActive = !!this.plugin.repoRegistry.getRepo(repo.folderPath);
        if (!isActive) {
            section.createEl("p", {
                text: "⚠️ this repository failed to load (folder missing or not a Git repository root).",
                cls: "setting-item-description mod-warning",
            });
        }

        // Remote URL — applied to the Git remote when the field loses focus
        new Setting(section)
            .setName("Remote URL")
            .setDesc(`Applied to the "${repo.remoteName || "origin"}" remote when you leave the field.`)
            .addText((text) => {
                text
                    .setValue(repo.remoteUrl)
                    .setPlaceholder("https://codeberg.org/user/repo.git")
                    .onChange(async (value) => {
                        repo.remoteUrl = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addEventListener("blur", () => {
                    if (!isActive || !repo.remoteUrl) return;
                    void this.plugin.repoRegistry
                        .setRemoteUrl(repo.folderPath, repo.remoteName || "origin", repo.remoteUrl)
                        .catch((e: Error) => new Notice(`Could not update remote: ${e.message}`));
                });
            });

        // Auto-push
        new Setting(section)
            .setName("Auto-push after commit")
            .addToggle((toggle) =>
                toggle.setValue(repo.autoPush).onChange(async (value) => {
                    repo.autoPush = value;
                    await this.plugin.saveSettings();
                })
            );

        // Auto-commit interval
        new Setting(section)
            .setName("Auto-commit interval (minutes)")
            .setDesc("Stages and commits all changes on a timer. Set to 0 to disable.")
            .addText((text) =>
                text
                    .setValue(String(repo.autoCommitInterval))
                    .setPlaceholder("0")
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            repo.autoCommitInterval = num;
                            await this.plugin.saveSettings();
                            this.plugin.repoRegistry.updateAutoCommit(repo.folderPath);
                        }
                    })
            );

        // Commit message template
        new Setting(section)
            .setName("Commit message template")
            .setDesc("Used by auto-commit and as the default message. Use {{date}} for current ISO date.")
            .addText((text) =>
                text
                    .setValue(repo.commitMessageTemplate)
                    .setPlaceholder("vault backup: {{date}}")
                    .onChange(async (value) => {
                        repo.commitMessageTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Remove repo button
        new Setting(section)
            .setDesc("Stops tracking this folder in the plugin. Your files and their Git history are kept.")
            .addButton((btn) => {
                btn.setButtonText("Remove")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.repoRegistry.removeRepo(repo.folderPath);
                        this.plugin.settings.repos = this.plugin.settings.repos.filter(
                            (r: FolderRepoConfig) => r.folderPath !== repo.folderPath
                        );
                        await this.plugin.saveSettings();
                        new Notice(`Removed repo for "${repo.folderPath || "vault root"}"`);
                        this.display();
                        await this.plugin.refreshViews();
                    });
            });
    }
}
