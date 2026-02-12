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

        // ── Global Settings ──────────────────────────────────────────────


        new Setting(containerEl)
            .setName("Git binary path")
            .setDesc("Custom path to Git executable. Leave empty to use system default.")
            .addText((text) =>
                text
                    .setPlaceholder("/usr/bin/Git")
                    .setValue(this.plugin.settings.gitBinaryPath)
                    .onChange((value) => {
                        void (async () => {
                            this.plugin.settings.gitBinaryPath = value;
                            await this.plugin.saveSettings();
                        })();
                    })
            );

        new Setting(containerEl)
            .setName("Show untracked files")
            .setDesc("Display untracked files in the source control view.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showUntrackedFiles)
                    .onChange((value) => {
                        void (async () => {
                            this.plugin.settings.showUntrackedFiles = value;
                            await this.plugin.saveSettings();
                        })();
                    })
            );

        new Setting(containerEl)
            .setName("Status refresh interval")
            .setDesc("How often to refresh Git status (in seconds). Set to 0 to disable auto-refresh.")
            .addText((text) =>
                text
                    .setPlaceholder("30")
                    .setValue(String(this.plugin.settings.refreshInterval))
                    .onChange((value) => {
                        void (async () => {
                            const num = parseInt(value, 10);
                            if (!isNaN(num) && num >= 0) {
                                this.plugin.settings.refreshInterval = num;
                                await this.plugin.saveSettings();
                                this.plugin.restartRefreshTimer();
                            }
                        })();
                    })
            );

        // ── GitHub Authentication ────────────────────────────────────────

        new Setting(containerEl).setName("GitHub authentication").setHeading();

        new Setting(containerEl)
            .setName("GitHub username")
            .setDesc("Auto-detected from token.")
            .addText((text) =>
                text
                    .setPlaceholder("Username")
                    .setValue(this.plugin.settings.githubUsername)
                    .setDisabled(true) // Username is auto-detected, not manually set
            );

        const tokenSetting = new Setting(containerEl)
            .setName("Personal access token")
            .setDesc("Generate a personal access token with 'repo' scope.");

        tokenSetting.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.setCssProps({ width: "250px" });
            text
                .setPlaceholder("Ghp_xxxxxxxxxxxx")
                .setValue(this.plugin.settings.githubToken)
                .onChange((value) => {
                    void (async () => {
                        this.plugin.settings.githubToken = value.trim();
                        await this.plugin.saveSettings();
                    })();
                });
        });

        tokenSetting.addButton((btn) => {
            btn.setButtonText("Validate")
                .setCta()
                .onClick(() => {
                    void (async () => {
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
                            new Notice("❌ invalid token. Please check and try again.");
                            this.display();
                        }
                    })();
                });
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
                    this.plugin.openAddRepoModal();
                    this.display(); // Refresh after modal closes
                });
        });
    }

    private renderRepoSettings(containerEl: HTMLElement, repo: FolderRepoConfig): void {
        const section = containerEl.createDiv("folder-git-settings-repo");

        // Repo header with folder path
        const header = section.createDiv("folder-git-settings-repo-header");
        new Setting(header).setName(`📁 ${repo.folderPath || "(vault root)"}`).setHeading();

        // Remote URL
        new Setting(section)
            .setName("Remote URL")
            .addText((text) =>
                text
                    .setValue(repo.remoteUrl)
                    .setPlaceholder("git@github.com:user/repo.git")
                    .onChange((value) => {
                        void (async () => {
                            repo.remoteUrl = value;
                            await this.plugin.saveSettings();
                        })();
                    })
            );

        // Auto-push
        new Setting(section)
            .setName("Auto-push after commit")
            .addToggle((toggle) =>
                toggle.setValue(repo.autoPush).onChange((value) => {
                    void (async () => {
                        repo.autoPush = value;
                        await this.plugin.saveSettings();
                    })();
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
                    .onChange((value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            void (async () => {
                                repo.autoCommitInterval = num;
                                await this.plugin.saveSettings();
                            })();
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
                    .onChange((value) => {
                        void (async () => {
                            repo.commitMessageTemplate = value;
                            await this.plugin.saveSettings();
                        })();
                    })
            );

        // Remove repo button
        new Setting(section).addButton((btn) => {
            btn.setButtonText("Remove")
                .setWarning()
                .onClick(() => {
                    void (async () => {
                        this.plugin.repoRegistry.removeRepo(repo.folderPath);
                        this.plugin.settings.repos = this.plugin.settings.repos.filter(
                            (r: FolderRepoConfig) => r.folderPath !== repo.folderPath
                        );
                        await this.plugin.saveSettings();
                        new Notice(`Removed repo for "${repo.folderPath || "vault root"}"`);
                        this.display();
                    })();
                });
        });
    }
}
