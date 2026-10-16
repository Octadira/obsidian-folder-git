import { Notice } from "obsidian";
import type { FolderGitPluginInterface } from "./types";
import { ConfirmModal } from "./modals/confirmModal";
import { promptText } from "./modals/promptModal";
import { pickItem } from "./modals/pickModal";

/**
 * Interactive branch, stash and commit-rewriting actions shared by the Source Control
 * panel and the command palette. Each one reports its own result and refreshes the views.
 */

function repoLabel(folderPath: string): string {
    return folderPath || "vault root";
}

/** Run `fn`, show failures as a notice and always refresh the views afterwards */
async function attempt(plugin: FolderGitPluginInterface, failure: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
    } catch (e) {
        new Notice(`${failure}: ${(e as Error).message}`, 8000);
    } finally {
        await plugin.refreshViews();
    }
}

/** Whether the current branch's tip is already on its upstream (rewriting it would need a force push) */
function isPublished(plugin: FolderGitPluginInterface, folderPath: string): boolean {
    const status = plugin.getCachedStatuses().get(folderPath);
    return !!status && status.tracking !== "" && status.ahead === 0;
}

interface BranchChoice {
    label: string;
    name: string;
    remote: boolean;
}

export async function switchBranch(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const { current, local, remoteOnly } = await plugin.repoRegistry.listBranches(folderPath);
    const choices: BranchChoice[] = [
        ...local.filter((n) => n !== current).map((n) => ({ label: n, name: n, remote: false })),
        ...remoteOnly.map((n) => ({ label: `${n} (remote)`, name: n, remote: true })),
    ];
    if (choices.length === 0) {
        new Notice("There are no other branches. Create one first.");
        return;
    }
    const choice = await pickItem(plugin.app, choices, (c) => c.label, `Switch from "${current}" to…`);
    if (!choice) return;
    await attempt(plugin, "Switch branch failed", async () => {
        await plugin.repoRegistry.checkout(folderPath, choice.name, choice.remote);
        new Notice(`Switched to "${choice.remote ? choice.name.slice(choice.name.indexOf("/") + 1) : choice.name}" (${repoLabel(folderPath)}).`);
    });
}

export async function createBranch(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const name = await promptText(plugin.app, {
        title: "New branch",
        description: `Creates a branch from the current commit in ${repoLabel(folderPath)} and switches to it.`,
        placeholder: "feature/my-branch",
        confirmText: "Create",
    });
    if (!name) return;
    await attempt(plugin, "Create branch failed", async () => {
        await plugin.repoRegistry.createBranch(folderPath, name);
        new Notice(`Created and switched to "${name}".`);
    });
}

export async function deleteBranch(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const { current, local } = await plugin.repoRegistry.listBranches(folderPath);
    const candidates = local.filter((n) => n !== current);
    if (candidates.length === 0) {
        new Notice("There is no other local branch to delete.");
        return;
    }
    const name = await pickItem(plugin.app, candidates, (n) => n, "Delete which branch?");
    if (!name) return;
    await attempt(plugin, "Delete branch failed", async () => {
        try {
            await plugin.repoRegistry.deleteBranch(folderPath, name);
        } catch (e) {
            if (!/not fully merged/i.test((e as Error).message)) throw e;
            const force = await new ConfirmModal(
                plugin.app,
                `"${name}" has commits that are not merged into another branch. Delete it anyway? Those commits may be lost.`,
                "Delete anyway"
            ).ask();
            if (!force) return;
            await plugin.repoRegistry.deleteBranch(folderPath, name, true);
        }
        new Notice(`Deleted branch "${name}".`);
    });
}

export async function mergeBranch(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const { current, local } = await plugin.repoRegistry.listBranches(folderPath);
    const candidates = local.filter((n) => n !== current);
    if (candidates.length === 0) {
        new Notice("There is no other local branch to merge.");
        return;
    }
    const name = await pickItem(plugin.app, candidates, (n) => n, `Merge which branch into "${current}"?`);
    if (!name) return;
    await attempt(plugin, "Merge failed", async () => {
        await plugin.repoRegistry.mergeBranch(folderPath, name);
        new Notice(`Merged "${name}" into "${current}".`);
    });
}

export async function stashChanges(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const message = await promptText(plugin.app, {
        title: "Stash changes",
        description: "Saves all changes, including untracked files, and restores a clean working tree.",
        placeholder: "Optional note",
        confirmText: "Stash",
        allowEmpty: true,
    });
    if (message === null) return;
    await attempt(plugin, "Stash failed", async () => {
        await plugin.repoRegistry.stashPush(folderPath, message);
        new Notice(`Stashed changes (${repoLabel(folderPath)}).`);
    });
}

export async function amendLastCommit(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    let current: string;
    try {
        current = await plugin.repoRegistry.getLastCommitMessage(folderPath);
    } catch (e) {
        new Notice(`Amend failed: ${(e as Error).message}`);
        return;
    }
    const message = await promptText(plugin.app, {
        title: "Amend last commit",
        description: "Changes staged right now are added to the last commit.",
        initial: current,
        confirmText: "Amend",
        multiline: true,
    });
    if (!message) return;
    if (isPublished(plugin, folderPath)) {
        const ok = await new ConfirmModal(
            plugin.app,
            "This commit has already been pushed. Amending it rewrites history, and the next push will need --force (done in a terminal). Amend anyway?",
            "Amend"
        ).ask();
        if (!ok) return;
    }
    await attempt(plugin, "Amend failed", async () => {
        await plugin.repoRegistry.amendLastCommit(folderPath, message);
        new Notice("Last commit amended.");
    });
}

export async function undoLastCommit(plugin: FolderGitPluginInterface, folderPath: string): Promise<void> {
    const published = isPublished(plugin, folderPath);
    const ok = await new ConfirmModal(
        plugin.app,
        "Undo the last commit? Its changes stay staged so nothing is lost." +
        (published ? " It has already been pushed, so the next push will need --force (done in a terminal)." : ""),
        "Undo commit"
    ).ask();
    if (!ok) return;
    await attempt(plugin, "Undo commit failed", async () => {
        await plugin.repoRegistry.undoLastCommit(folderPath);
        new Notice("Last commit undone; its changes are staged.");
    });
}
