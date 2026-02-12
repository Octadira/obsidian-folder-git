import { PluginSettingTab, Setting, App, Notice } from "obsidian";
import type FolderGitPlugin from "./main";
import type { FolderRepoConfig } from "./types";
import { GitHubService } from "./githubService";

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

        containerEl.createEl("h2", { text: "Folder Git Settings" });

        new Setting(containerEl)
            .setName("Git Binary Path")
            .setDesc("Custom path to Git executable. Leave empty to use system default.")
            .addText((text) =>
                text
                    .setPlaceholder("/usr/bin/git")
                    .setValue(this.plugin.settings.gitBinaryPath)
                    .onChange(async (value) => {
                        this.plugin.settings.gitBinaryPath = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show Untracked Files")
            .setDesc("Display untracked files in the Source Control view.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showUntrackedFiles)
                    .onChange(async (value) => {
                        this.plugin.settings.showUntrackedFiles = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Status Refresh Interval")
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

        containerEl.createEl("h3", { text: "GitHub Authentication" });

        const tokenSetting = new Setting(containerEl)
            .setName("Personal Access Token")
            .setDesc(
                this.plugin.settings.githubUsername
                    ? `✅ Authenticated as ${this.plugin.settings.githubUsername}`
                    : "Enter a GitHub PAT with 'repo' scope to enable GitHub integration."
            );

        tokenSetting.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.style.width = "250px";
            text
                .setPlaceholder("ghp_xxxxxxxxxxxx")
                .setValue(this.plugin.settings.githubToken)
                .onChange(async (value) => {
                    this.plugin.settings.githubToken = value.trim();
                    await this.plugin.saveSettings();
                });
        });

        tokenSetting.addButton((btn) => {
            btn.setButtonText("Validate")
                .setCta()
                .onClick(async () => {
                    const token = this.plugin.settings.githubToken;
                    if (!token) {
                        new Notice("Please enter a GitHub token first.");
                        return;
                    }
                    try {
                        btn.setButtonText("Checking...");
                        btn.setDisabled(true);
                        const gh = new GitHubService(token);
                        const user = await gh.validateToken();
                        this.plugin.settings.githubUsername = user.login;
                        await this.plugin.saveSettings();
                        new Notice(`✅ Authenticated as ${user.login}`);
                        this.display(); // Refresh to show username
                    } catch {
                        this.plugin.settings.githubUsername = "";
                        await this.plugin.saveSettings();
                        new Notice("❌ Invalid token. Please check and try again.");
                        this.display();
                    }
                });
        });

        // ── Repository List ──────────────────────────────────────────────

        containerEl.createEl("h3", { text: "Configured Repositories" });

        if (this.plugin.settings.repos.length === 0) {
            containerEl.createEl("p", {
                text: 'No repositories configured. Use the "Add Folder Repository" command or button in the Source Control view.',
                cls: "setting-item-description",
            });
        }

        for (const repo of this.plugin.settings.repos) {
            this.renderRepoSettings(containerEl, repo);
        }

        // Add repo button
        new Setting(containerEl).addButton((btn) => {
            btn.setButtonText("Add Folder Repository")
                .setCta()
                .onClick(() => {
                    this.plugin.openAddRepoModal();
                    this.display(); // Refresh after modal closes
                });
        });
    }

    private renderRepoSettings(containerEl: HTMLElement, repo: FolderRepoConfig): void {
        const section = containerEl.createDiv("folder-git-settings-repo");

        // Repo header with folder path
        const header = section.createDiv("folder-git-settings-repo-header");
        header.createEl("h4", { text: `📁 ${repo.folderPath || "(vault root)"}` });

        // Remote URL
        new Setting(section)
            .setName("Remote URL")
            .addText((text) =>
                text
                    .setValue(repo.remoteUrl)
                    .setPlaceholder("git@github.com:user/repo.git")
                    .onChange(async (value) => {
                        repo.remoteUrl = value;
                        await this.plugin.saveSettings();
                    })
            );

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
            .setDesc("Set to 0 to disable.")
            .addText((text) =>
                text
                    .setValue(String(repo.autoCommitInterval))
                    .setPlaceholder("0")
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            repo.autoCommitInterval = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        // Commit message template
        new Setting(section)
            .setName("Commit message template")
            .setDesc("Use {{date}} for current ISO date.")
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
        new Setting(section).addButton((btn) => {
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
                });
        });
    }
}
