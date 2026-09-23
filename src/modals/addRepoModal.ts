import { Modal, App, Setting, Notice, TFolder, type ButtonComponent, type TextComponent } from "obsidian";
import { fs } from "../nodeApi";
import { DEFAULT_REPO_CONFIG, type FolderRepoConfig, type PluginSettings } from "../types";
import type { RepoRegistry } from "../repoRegistry";
import {
    HOSTING_PROVIDER_LABELS,
    createHostingService,
    getConfiguredAccounts,
    type HostingOrg,
    type HostingProviderId,
    type OrgVisibility,
} from "../hosting/hostingService";

const NEW_ORG_OPTION = "__new_org__";

type OrgListState =
    | { status: "loading" }
    | { status: "ok"; orgs: HostingOrg[] }
    | { status: "error"; message: string };

/** Minimal interface to avoid circular import with main.ts */
interface FolderGitPluginRef {
    settings: PluginSettings;
    repoRegistry: RepoRegistry;
    saveSettings(): Promise<void>;
}

type RepoMode = "existing" | "init" | "clone";

/**
 * Modal for adding a new folder repository.
 * Supports: existing repo, git init, clone — with optional remote repo creation
 * on GitHub or a Forgejo/Gitea instance.
 */
export class AddRepoModal extends Modal {
    private plugin: FolderGitPluginRef;
    private folderPath: string = "";
    private mode: RepoMode = "existing";
    private remoteUrl: string = "";
    private detectedRemote: string = "";
    private cloneUrl: string = "";
    private cloneSubfolder: string = "";
    private createOn: HostingProviderId | "" = "";
    private remoteRepoName: string = "";
    private remoteOwner: string = "";
    private isPrivate: boolean = true;
    /** "Create new organization..." selected in the owner dropdown */
    private newOrgMode = false;
    private newOrgName: string = "";
    private newOrgVisibility: OrgVisibility = "private";
    private orgCache: Partial<Record<HostingProviderId, OrgListState>> = {};
    private closed = false;
    private busy = false;
    private renderToken = 0;
    private onDone: () => void;

    constructor(app: App, plugin: FolderGitPluginRef, onDone: () => void, initialFolderPath?: string) {
        super(app);
        this.plugin = plugin;
        this.onDone = onDone;
        this.setFolder(initialFolderPath ?? "");
    }

    private setFolder(folderPath: string): void {
        this.folderPath = folderPath;
        this.remoteRepoName = this.slugify(folderPath.split("/").pop() || "obsidian-vault");
        this.remoteUrl = "";
        this.detectedRemote = "";
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        const token = ++this.renderToken;
        new Setting(contentEl).setName("Add folder repository").setHeading();

        // Folder selector
        new Setting(contentEl)
            .setName("Folder")
            .setDesc("Select the folder to track with Git.")
            .addDropdown((dropdown) => {
                dropdown.addOption("", "(vault root)");
                for (const f of this.getAllFolders()) {
                    dropdown.addOption(f, f);
                }
                dropdown.setValue(this.folderPath);
                dropdown.onChange((value) => {
                    this.setFolder(value);
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

        if (this.mode === "clone") {
            this.renderCloneFields(contentEl);
        } else {
            this.renderRemoteFields(contentEl, token);
            this.renderCreateRemoteFields(contentEl);
        }

        // Add button
        new Setting(contentEl).addButton((btn) => {
            btn.setButtonText("Add repository")
                .setCta()
                .onClick(() => { void this.handleAdd(btn); });
        });
    }

    private renderCloneFields(contentEl: HTMLElement): void {
        let subfolderText: TextComponent | null = null;

        new Setting(contentEl)
            .setName("Clone URL")
            .setDesc("HTTPS or SSH URL. Private HTTPS repositories on GitHub or your Forgejo instance use the tokens from settings.")
            .addText((text) =>
                text
                    .setPlaceholder("https://codeberg.org/user/repo.git")
                    .setValue(this.cloneUrl)
                    .onChange((value) => {
                        const previousDefault = this.repoNameFromUrl(this.cloneUrl);
                        this.cloneUrl = value.trim();
                        // Keep the subfolder in sync with the URL until the user edits it
                        if (!this.cloneSubfolder || this.cloneSubfolder === previousDefault) {
                            this.cloneSubfolder = this.repoNameFromUrl(this.cloneUrl);
                            subfolderText?.setValue(this.cloneSubfolder);
                        }
                    })
            );

        new Setting(contentEl)
            .setName("Clone into subfolder")
            .setDesc("New folder created inside the selected folder. Leave empty to clone directly into the selected folder (it must be empty).")
            .addText((text) => {
                subfolderText = text;
                text
                    .setPlaceholder("Repo")
                    .setValue(this.cloneSubfolder)
                    .onChange((value) => (this.cloneSubfolder = value.trim()));
            });
    }

    private renderRemoteFields(contentEl: HTMLElement, token: number): void {
        let remoteText: TextComponent | null = null;
        const remoteSetting = new Setting(contentEl)
            .setName("Remote URL")
            .setDesc("Optional. Filled in automatically when creating a remote repository below.")
            .addText((text) => {
                remoteText = text;
                text
                    .setPlaceholder("https://github.com/user/repo.git")
                    .setValue(this.remoteUrl)
                    .onChange((value) => (this.remoteUrl = value.trim()));
            });

        // Show detected remote for existing repos
        if (this.mode === "existing") {
            void this.detectRemote().then((remote) => {
                if (token !== this.renderToken || !remote) return;
                this.detectedRemote = remote.fetchUrl;
                if (!this.remoteUrl) {
                    this.remoteUrl = remote.fetchUrl;
                    remoteText?.setValue(remote.fetchUrl);
                }
                remoteSetting.descEl.empty();
                remoteSetting.descEl.createSpan({
                    text: `Detected remote: ${remote.name} → ${remote.fetchUrl}`,
                    cls: "folder-git-detected-remote",
                });
            });
        }
    }

    private renderCreateRemoteFields(contentEl: HTMLElement): void {
        const accounts = getConfiguredAccounts(this.plugin.settings);
        if (this.createOn && !accounts.some((a) => a.id === this.createOn)) {
            this.createOn = "";
        }

        new Setting(contentEl)
            .setName("Create remote repository")
            .setDesc(
                accounts.length > 0
                    ? "Create a new, empty repository and use it as the remote."
                    : "Configure and validate a GitHub or Forgejo token in settings to enable this."
            )
            .addDropdown((dropdown) => {
                dropdown.addOption("", "Don't create");
                for (const account of accounts) {
                    dropdown.addOption(
                        account.id,
                        `${HOSTING_PROVIDER_LABELS[account.id]} (${account.username}@${account.gitHost})`
                    );
                }
                dropdown.setValue(this.createOn);
                dropdown.setDisabled(accounts.length === 0);
                dropdown.onChange((value) => {
                    this.createOn = value as HostingProviderId | "";
                    // Organizations are provider-specific
                    this.remoteOwner = "";
                    this.newOrgMode = false;
                    this.rerender();
                });
            });

        const account = accounts.find((a) => a.id === this.createOn);
        if (!this.createOn || !account) return;

        new Setting(contentEl)
            .setName("Repository name")
            .addText((text) =>
                text
                    .setValue(this.remoteRepoName)
                    .setPlaceholder("My-notes")
                    .onChange((value) => (this.remoteRepoName = value.trim()))
            );

        this.renderOwnerFields(contentEl, this.createOn, account.username);

        new Setting(contentEl)
            .setName("Visibility")
            .addDropdown((dropdown) => {
                dropdown.addOption("private", "🔒 private");
                dropdown.addOption("public", "🌐 public");
                dropdown.setValue(this.isPrivate ? "private" : "public");
                dropdown.onChange((value) => {
                    this.isPrivate = value === "private";
                });
            });
    }

    /** Owner selector: personal account, one of the user's organizations, or a new organization */
    private renderOwnerFields(contentEl: HTMLElement, providerId: HostingProviderId, username: string): void {
        const service = createHostingService(this.plugin.settings, providerId);
        const canCreateOrg = !!service?.createOrganization;
        const state = this.orgCache[providerId];
        if (!state) void this.loadOrgs(providerId, username);

        const orgs = state?.status === "ok" ? state.orgs : [];
        const selected = orgs.find((o) => o.name === this.remoteOwner);

        let desc = "Where the repository is created.";
        if (!state || state.status === "loading") {
            desc = "Loading your organizations...";
        } else if (state.status === "error") {
            desc = `Could not load organizations (${state.message}). Check that the token can read organizations.`;
        } else if (selected && !selected.canCreateRepo) {
            desc = `⚠️ You may not have permission to create repositories in "${selected.name}".`;
        }

        const ownerSetting = new Setting(contentEl)
            .setName("Owner")
            .setDesc(desc)
            .addDropdown((dropdown) => {
                dropdown.addOption("", `My account (${username})`);
                for (const org of orgs) {
                    dropdown.addOption(org.name, org.canCreateRepo ? org.name : `${org.name} (no permission)`);
                }
                // Keep a previously chosen owner visible even if the list is not loaded yet
                if (this.remoteOwner && !selected) {
                    dropdown.addOption(this.remoteOwner, this.remoteOwner);
                }
                if (canCreateOrg) {
                    dropdown.addOption(NEW_ORG_OPTION, "New organization...");
                }
                dropdown.setValue(this.newOrgMode ? NEW_ORG_OPTION : this.remoteOwner);
                dropdown.onChange((value) => {
                    this.newOrgMode = value === NEW_ORG_OPTION;
                    this.remoteOwner = this.newOrgMode ? "" : value;
                    this.rerender();
                });
            })
            .addExtraButton((btn) =>
                btn
                    .setIcon("refresh-cw")
                    .setTooltip("Reload organizations")
                    .onClick(() => {
                        delete this.orgCache[providerId];
                        this.rerender();
                    })
            );
        if (state?.status === "error") ownerSetting.descEl.addClass("mod-warning");

        if (!this.newOrgMode || !service?.createOrganization) return;

        new Setting(contentEl)
            .setName("New organization")
            .setDesc("Letters, numbers, dashes, underscores and dots. Visibility: limited = visible to signed-in users only.")
            .addText((text) =>
                text
                    .setPlaceholder("My-org")
                    .setValue(this.newOrgName)
                    .onChange((value) => (this.newOrgName = value.trim()))
            )
            .addDropdown((dropdown) => {
                dropdown.addOption("private", "🔒 private");
                dropdown.addOption("limited", "👥 limited");
                dropdown.addOption("public", "🌐 public");
                dropdown.setValue(this.newOrgVisibility);
                dropdown.onChange((value) => (this.newOrgVisibility = value as OrgVisibility));
            })
            .addButton((btn) =>
                btn.setButtonText("Create").onClick(async () => {
                    btn.setDisabled(true).setButtonText("Creating...");
                    const ok = await this.createNewOrg(providerId);
                    if (ok) {
                        this.rerender();
                    } else {
                        btn.setDisabled(false).setButtonText("Create");
                    }
                })
            );
    }

    private async loadOrgs(providerId: HostingProviderId, username: string): Promise<void> {
        const service = createHostingService(this.plugin.settings, providerId);
        if (!service) return;
        this.orgCache[providerId] = { status: "loading" };
        try {
            const orgs = await service.listOrganizations(username);
            orgs.sort((a, b) => a.name.localeCompare(b.name));
            this.orgCache[providerId] = { status: "ok", orgs };
        } catch (e) {
            this.orgCache[providerId] = { status: "error", message: (e as Error).message };
        }
        if (!this.closed && this.createOn === providerId) this.rerender();
    }

    /** Create the organization typed in "New organization" and select it as owner */
    private async createNewOrg(providerId: HostingProviderId): Promise<boolean> {
        const service = createHostingService(this.plugin.settings, providerId);
        if (!service?.createOrganization) return false;
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(this.newOrgName)) {
            new Notice("Enter a valid organization name (letters, numbers, dashes, underscores, dots).");
            return false;
        }
        try {
            const org = await service.createOrganization(this.newOrgName, this.newOrgVisibility);
            const state = this.orgCache[providerId];
            const orgs = state?.status === "ok" ? state.orgs : [];
            this.orgCache[providerId] = {
                status: "ok",
                orgs: [...orgs.filter((o) => o.name !== org.name), org].sort((a, b) => a.name.localeCompare(b.name)),
            };
            this.remoteOwner = org.name;
            this.newOrgMode = false;
            this.newOrgName = "";
            new Notice(`✅ Created organization "${org.name}"`);
            return true;
        } catch (e) {
            new Notice(`Could not create organization: ${(e as Error).message}`, 8000);
            return false;
        }
    }

    private rerender(): void {
        this.onOpen();
    }

    private async detectRemote(): Promise<{ name: string; fetchUrl: string } | null> {
        try {
            const absolutePath = this.plugin.repoRegistry.resolveAbsolutePath(this.folderPath);
            const remotes = await this.plugin.repoRegistry.detectRemotesFromPath(absolutePath);
            const remote = remotes.find((r) => r.name === "origin") || remotes[0];
            return remote && remote.fetchUrl ? remote : null;
        } catch {
            return null;
        }
    }

    private getAllFolders(): string[] {
        const folders: string[] = [];
        const skip = (folder: TFolder) =>
            folder.name === this.app.vault.configDir || folder.name === ".git";

        const recurse = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder && !skip(child)) {
                    folders.push(child.path);
                    recurse(child);
                }
            }
        };
        recurse(this.app.vault.getRoot());
        return folders.sort((a, b) => a.localeCompare(b));
    }

    private repoNameFromUrl(url: string): string {
        const match = url.trim().replace(/\/+$/, "").match(/([^/:]+?)(\.git)?$/);
        return match ? match[1] : "";
    }

    private slugify(name: string): string {
        return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "obsidian-vault";
    }

    private async handleAdd(btn: ButtonComponent): Promise<void> {
        if (this.busy) return;

        // Final vault-relative folder for the repo
        let folderPath = this.folderPath;
        if (this.mode === "clone") {
            if (!this.cloneUrl) {
                new Notice("A clone URL is required.");
                return;
            }
            if (this.cloneSubfolder) {
                if (/[\\:*?"<>|]|(^|\/)\.\.(\/|$)/.test(this.cloneSubfolder)) {
                    new Notice("Invalid subfolder name.");
                    return;
                }
                folderPath = folderPath ? `${folderPath}/${this.cloneSubfolder}` : this.cloneSubfolder;
            }
        }

        if (this.plugin.settings.repos.some((r) => r.folderPath === folderPath)) {
            new Notice(`"${folderPath || "vault root"}" is already configured.`);
            return;
        }

        if (this.createOn && !this.remoteRepoName) {
            new Notice("Please enter a repository name.");
            return;
        }

        if (this.createOn && this.newOrgMode) {
            // Organization typed in but not created yet — create it now
            if (!this.newOrgName) {
                new Notice("Enter a name for the new organization, or choose another owner.");
                return;
            }
            if (!(await this.createNewOrg(this.createOn))) return;
        }

        this.busy = true;
        btn.setDisabled(true).setButtonText("Working...");

        try {
            const registry = this.plugin.repoRegistry;
            const absolutePath = registry.resolveAbsolutePath(folderPath);

            // Create the remote repo first so a failure leaves nothing half-done locally
            let createdRemoteUrl = "";
            if (this.mode !== "clone" && this.createOn) {
                const service = createHostingService(this.plugin.settings, this.createOn);
                if (!service) throw new Error(`${HOSTING_PROVIDER_LABELS[this.createOn]} is not configured.`);
                const label = HOSTING_PROVIDER_LABELS[this.createOn];
                new Notice(`Creating ${label} repository...`);
                const repo = await service.createRepo(
                    this.remoteRepoName,
                    this.isPrivate,
                    "",
                    this.remoteOwner || undefined
                );
                createdRemoteUrl = repo.clone_url; // HTTPS URL
                new Notice(`✅ Created ${label} repo: ${repo.full_name}`);
            }

            if (this.mode === "init") {
                if (fs.existsSync(`${absolutePath}/.git`)) {
                    new Notice("Folder is already a Git repository — using it as is.");
                } else {
                    await registry.initRepo(absolutePath);
                    new Notice(`Initialized new Git repo in "${folderPath || "vault root"}"`);
                }
            } else if (this.mode === "clone") {
                await registry.cloneRepo(this.cloneUrl, absolutePath);
                new Notice(`Cloned repo into "${folderPath || "vault root"}"`);
            }

            const finalRemoteUrl =
                createdRemoteUrl || (this.mode === "clone" ? this.cloneUrl : this.remoteUrl);

            const config: FolderRepoConfig = {
                ...DEFAULT_REPO_CONFIG,
                folderPath,
                remoteUrl: finalRemoteUrl,
                // Auto-push only makes sense when there is somewhere to push
                autoPush: !!finalRemoteUrl,
                hostingProvider: this.createOn,
                remoteRepoName: this.createOn ? this.remoteRepoName : "",
                isPrivate: this.isPrivate,
            };

            await registry.addRepo(config);

            if (finalRemoteUrl && this.mode !== "clone" && finalRemoteUrl !== this.detectedRemote) {
                await registry.setRemoteUrl(folderPath, config.remoteName, finalRemoteUrl);
            }

            this.plugin.settings.repos.push(config);
            await this.plugin.saveSettings();

            new Notice(`Added repo for "${folderPath || "vault root"}"`);
            this.close();
            this.onDone();
        } catch (e) {
            new Notice(`Failed: ${(e as Error).message}`);
        } finally {
            this.busy = false;
            btn.setDisabled(false).setButtonText("Add repository");
        }
    }

    onClose(): void {
        this.closed = true;
        this.renderToken++;
        this.contentEl.empty();
    }
}
