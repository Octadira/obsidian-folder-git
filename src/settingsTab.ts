import { PluginSettingTab, Setting, App, Notice, type SettingDefinitionItem } from "obsidian";
import type FolderGitPlugin from "./main";
import type { FolderRepoConfig } from "./types";
import { GitHubService } from "./hosting/githubService";
import { ForgejoService } from "./hosting/forgejoService";
import { normalizeInstanceUrl, type HostingService } from "./hosting/hostingService";

/** One settings row, defined once and rendered by both the declarative API and the legacy `display()` */
interface SettingSpec {
    name: string;
    desc?: string;
    /** Adds the row's controls; the name and description are already set */
    build?: (setting: Setting) => unknown;
}

interface SettingSection {
    heading?: string;
    specs: SettingSpec[];
}

/** Obsidian's change/click callbacks do not await; run async work fire-and-forget */
function voidHandler<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
    return (...args) => { void fn(...args); };
}

export class FolderGitSettingsTab extends PluginSettingTab {
    plugin: FolderGitPlugin;

    constructor(app: App, plugin: FolderGitPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** Declarative settings (Obsidian 1.13+): rows are indexed by the settings search */
    getSettingDefinitions(): SettingDefinitionItem[] {
        return this.sections().map((section): SettingDefinitionItem => ({
            type: "group",
            heading: section.heading,
            items: section.specs.map((spec) => ({
                name: spec.name,
                desc: spec.desc,
                render: (setting: Setting) => {
                    setting.setName(spec.name);
                    if (spec.desc) setting.setDesc(spec.desc);
                    spec.build?.(setting);
                },
            })),
        }));
    }

    /** Imperative rendering, used by Obsidian versions before 1.13 */
    display(): void {
        this.renderLegacy();
    }

    private renderLegacy(): void {
        const { containerEl } = this;
        containerEl.empty();

        for (const section of this.sections()) {
            if (section.heading) new Setting(containerEl).setName(section.heading).setHeading();
            for (const spec of section.specs) {
                const setting = new Setting(containerEl).setName(spec.name);
                if (spec.desc) setting.setDesc(spec.desc);
                spec.build?.(setting);
            }
        }
    }

    /** Rebuild the tab after state that changes its structure (account status, repository list) */
    private rerender(): void {
        // update() only exists on Obsidian 1.13+, where the declarative definitions are re-read
        const tab = this as { update?: () => void };
        if (tab.update) tab.update();
        else this.renderLegacy();
    }

    private sections(): SettingSection[] {
        return [
            this.generalSection(),
            this.githubSection(),
            this.forgejoSection(),
            this.repositoriesSection(),
            ...this.plugin.settings.repos.map((repo) => this.repoSection(repo)),
        ];
    }

    // ── Global settings ───────────────────────────────────────────────────

    private generalSection(): SettingSection {
        const settings = this.plugin.settings;
        return {
            specs: [
                {
                    name: "Git binary path",
                    desc: "Custom path to Git executable. Leave empty to use system default. Takes effect after reloading the plugin.",
                    build: (setting) =>
                        setting.addText((text) =>
                            text
                                .setPlaceholder("/usr/bin/Git")
                                .setValue(settings.gitBinaryPath)
                                .onChange(voidHandler(async (value) => {
                                    settings.gitBinaryPath = value.trim();
                                    await this.plugin.saveSettings();
                                }))
                        ),
                },
                {
                    name: "Show untracked files",
                    desc: "Display untracked files in the source control view.",
                    build: (setting) =>
                        setting.addToggle((toggle) =>
                            toggle.setValue(settings.showUntrackedFiles).onChange(voidHandler(async (value) => {
                                settings.showUntrackedFiles = value;
                                await this.plugin.saveSettings();
                                await this.plugin.refreshViews();
                            }))
                        ),
                },
                {
                    name: "Status refresh interval",
                    desc: "How often to refresh Git status (in seconds). Set to 0 to disable auto-refresh.",
                    build: (setting) =>
                        setting.addText((text) =>
                            text
                                .setPlaceholder("30")
                                .setValue(String(settings.refreshInterval))
                                .onChange(voidHandler(async (value) => {
                                    const num = parseInt(value, 10);
                                    if (!isNaN(num) && num >= 0) {
                                        settings.refreshInterval = num;
                                        await this.plugin.saveSettings();
                                        this.plugin.restartRefreshTimer();
                                    }
                                }))
                        ),
                },
            ],
        };
    }

    private accountSpec(username: string): SettingSpec {
        return {
            name: "Account",
            desc: username ? `✅ Authenticated as ${username}` : "Not connected. Enter a token and click validate.",
        };
    }

    private githubSection(): SettingSection {
        const settings = this.plugin.settings;
        return {
            heading: "GitHub",
            specs: [
                this.accountSpec(settings.githubUsername),
                {
                    name: "Personal access token",
                    desc: "Classic token with 'repo' scope, or a fine-grained token with contents and administration (write) permissions.",
                    build: (setting) => {
                        setting.addText((text) => {
                            text.inputEl.type = "password";
                            text.inputEl.addClass("folder-git-token-input");
                            text
                                .setPlaceholder("Token")
                                .setValue(settings.githubToken)
                                .onChange(voidHandler(async (value) => {
                                    settings.githubToken = value.trim();
                                    settings.githubUsername = "";
                                    await this.plugin.saveSettings();
                                }));
                        });
                        setting.addButton((btn) => {
                            btn.setButtonText("Validate")
                                .setCta()
                                .onClick(voidHandler(async () => {
                                    if (!settings.githubToken) {
                                        new Notice("Please enter a GitHub token first.");
                                        return;
                                    }
                                    btn.setButtonText("Checking...").setDisabled(true);
                                    settings.githubUsername = await this.validate(new GitHubService(settings.githubToken), "GitHub");
                                    await this.plugin.saveSettings();
                                    this.rerender();
                                }));
                        });
                    },
                },
            ],
        };
    }

    private forgejoSection(): SettingSection {
        const settings = this.plugin.settings;
        return {
            heading: "Forgejo",
            specs: [
                this.accountSpec(settings.forgejoUsername),
                {
                    name: "Instance URL",
                    desc: "Base URL of your Forgejo server. Works with any Forgejo or Gitea instance, including Codeberg.",
                    build: (setting) =>
                        setting.addText((text) => {
                            text.inputEl.addClass("folder-git-token-input");
                            text
                                .setPlaceholder("https://codeberg.org")
                                .setValue(settings.forgejoUrl)
                                .onChange(voidHandler(async (value) => {
                                    settings.forgejoUrl = value.trim();
                                    settings.forgejoUsername = "";
                                    await this.plugin.saveSettings();
                                }));
                        }),
                },
                {
                    name: "Access token",
                    desc: "Create one under settings → applications, with read/write access to 'repository' and read access to 'user' (plus 'organization': read to list your organizations, read/write to create organizations).",
                    build: (setting) => {
                        setting.addText((text) => {
                            text.inputEl.type = "password";
                            text.inputEl.addClass("folder-git-token-input");
                            text
                                .setPlaceholder("Token")
                                .setValue(settings.forgejoToken)
                                .onChange(voidHandler(async (value) => {
                                    settings.forgejoToken = value.trim();
                                    settings.forgejoUsername = "";
                                    await this.plugin.saveSettings();
                                }));
                        });
                        setting.addButton((btn) => {
                            btn.setButtonText("Validate")
                                .setCta()
                                .onClick(voidHandler(async () => {
                                    const { forgejoToken: token, forgejoUrl } = settings;
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
                                    settings.forgejoUrl = baseUrl;
                                    settings.forgejoUsername = await this.validate(new ForgejoService(baseUrl, token), "Forgejo");
                                    await this.plugin.saveSettings();
                                    this.rerender();
                                }));
                        });
                    },
                },
                {
                    name: "About tokens",
                    desc: "Tokens are stored in this vault's plugin data and are only passed to Git through environment variables during push, pull, fetch and clone over HTTPS for the matching host. SSH remotes use your SSH keys.",
                },
            ],
        };
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

    // ── Repositories ──────────────────────────────────────────────────────

    private repositoriesSection(): SettingSection {
        const specs: SettingSpec[] = [];
        if (this.plugin.settings.repos.length === 0) {
            specs.push({
                name: "No repositories configured",
                desc: 'Use the "add folder repository" command or button in the source control view.',
            });
        }
        specs.push({
            name: "Add folder repository",
            build: (setting) =>
                setting.addButton((btn) => {
                    btn.setButtonText("Add folder repository")
                        .setCta()
                        .onClick(() => {
                            this.plugin.openAddRepoModal(undefined, () => this.rerender());
                        });
                }),
        });
        return { heading: "Configured repositories", specs };
    }

    private repoSection(repo: FolderRepoConfig): SettingSection {
        const isActive = !!this.plugin.repoRegistry.getRepo(repo.folderPath);
        const specs: SettingSpec[] = [];

        if (!isActive) {
            specs.push({
                name: "Repository not loaded",
                desc: "⚠️ this repository failed to load (folder missing or not a Git repository root).",
            });
        }

        // Applied to the Git remote when the field loses focus
        specs.push({
            name: "Remote URL",
            desc: `Applied to the "${repo.remoteName || "origin"}" remote when you leave the field.`,
            build: (setting) =>
                setting.addText((text) => {
                    text
                        .setValue(repo.remoteUrl)
                        .setPlaceholder("https://codeberg.org/user/repo.git")
                        .onChange(voidHandler(async (value) => {
                            repo.remoteUrl = value.trim();
                            await this.plugin.saveSettings();
                        }));
                    text.inputEl.addEventListener("blur", () => {
                        if (!isActive || !repo.remoteUrl) return;
                        void this.plugin.repoRegistry
                            .setRemoteUrl(repo.folderPath, repo.remoteName || "origin", repo.remoteUrl)
                            .catch((e: Error) => new Notice(`Could not update remote: ${e.message}`));
                    });
                }),
        });

        specs.push({
            name: "Auto-push after commit",
            build: (setting) =>
                setting.addToggle((toggle) =>
                    toggle.setValue(repo.autoPush).onChange(voidHandler(async (value) => {
                        repo.autoPush = value;
                        await this.plugin.saveSettings();
                    }))
                ),
        });

        specs.push({
            name: "Auto-commit interval (minutes)",
            desc: "Stages and commits all changes on a timer. Set to 0 to disable.",
            build: (setting) =>
                setting.addText((text) =>
                    text
                        .setValue(String(repo.autoCommitInterval))
                        .setPlaceholder("0")
                        .onChange(voidHandler(async (value) => {
                            const num = parseInt(value, 10);
                            if (!isNaN(num) && num >= 0) {
                                repo.autoCommitInterval = num;
                                await this.plugin.saveSettings();
                                this.plugin.repoRegistry.updateAutoCommit(repo.folderPath);
                            }
                        }))
                ),
        });

        specs.push({
            name: "Commit message template",
            desc: "Used by auto-commit and as the default message. Placeholders: {{date}}, {{time}}, {{repo}}, {{branch}}, {{files}}.",
            build: (setting) =>
                setting.addText((text) =>
                    text
                        .setValue(repo.commitMessageTemplate)
                        .setPlaceholder("vault backup: {{date}}")
                        .onChange(voidHandler(async (value) => {
                            repo.commitMessageTemplate = value;
                            await this.plugin.saveSettings();
                        }))
                ),
        });

        specs.push({
            name: "Remove repository",
            desc: "Stops tracking this folder in the plugin. Your files and their Git history are kept.",
            build: (setting) =>
                setting.addButton((btn) => {
                    btn.setButtonText("Remove")
                        .onClick(voidHandler(async () => {
                            this.plugin.repoRegistry.removeRepo(repo.folderPath);
                            this.plugin.settings.repos = this.plugin.settings.repos.filter(
                                (r: FolderRepoConfig) => r.folderPath !== repo.folderPath
                            );
                            await this.plugin.saveSettings();
                            new Notice(`Removed repo for "${repo.folderPath || "vault root"}"`);
                            this.rerender();
                            await this.plugin.refreshViews();
                        }));
                    // Same styling as setWarning(), which is deprecated; setDestructive() needs Obsidian 1.13+
                    btn.buttonEl.addClass("mod-warning");
                }),
        });

        return { heading: `📁 ${repo.folderPath || "(vault root)"}`, specs };
    }
}
