# Obsidian Folder Git

![GitHub release (latest by date)](https://img.shields.io/github/v/release/octadira/obsidian-folder-git)
![GitHub downloads](https://img.shields.io/github/downloads/octadira/obsidian-folder-git/total)

**Folder Git** is an Obsidian plugin that brings VS Code-style Git source control to your vault. Unlike other Git plugins that force a single repository for the entire vault, Folder Git allows you to manage **multiple independent Git repositories** for individual folders.

## Features

- **Multi-Repo Support**: Manage separate Git repositories for different folders within the same vault.
- **VS Code-Inspired UI**: Familiar Source Control panel with staged changes, commit input, and file status badges.
- **Git Operations**:
  - Stage/Unstage specific files or all changes.
  - Commit with message (`Ctrl/Cmd+Enter`), or leave the message empty to use the repo's template.
  - Push, Pull, Sync (pull then push) and Fetch.
  - View colored Diff for file changes, and per-file diffs of past commits in History.
  - Resolve merge conflicts by marking files as resolved.
- **GitHub and Forgejo Integration**:
  - Works with GitHub and any Forgejo or Gitea instance (e.g. Codeberg or self-hosted).
  - Create a new remote repository (personal or in an organization) when adding a folder.
  - Clone private repositories over HTTPS.
  - Authentication via access tokens. Tokens are handed to Git in memory, only for the matching host, and are never written to `.git/config` or credential files.
- **Auto-Backup**: Configure auto-commit and auto-push intervals per repository.
- **Context Menu Integration**: Right-click folders to add them as repositories, open source control/history, pull, push or edit `.gitignore`.

## Installation

### From Community Plugins (Recommended)
*Once approved:*
1. Open Settings > Community Plugins
2. Turn off Safe Mode
3. Click Browse and search for **Folder Git**
4. Install and Enable

### Manual Installation
1. Go to the [Releases](https://github.com/octadira/obsidian-folder-git/releases) page.
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. Create a folder in your vault: `.obsidian/plugins/folder-git/`.
4. Copy the downloaded files into that folder.
5. Reload Obsidian and enable the plugin.

## Usage

### Adding a Repository
1. Click the **Folder Git: Add Folder Repository** command or use the ribbon icon.
2. Select the folder you want to track.
3. Choose a mode:
   - **Existing**: Use an existing `.git` repository in that folder.
   - **Init**: Initialize a new Git repository.
   - **Clone**: Clone a repository from a URL into a new subfolder (or directly into an empty folder).
4. Optionally, for Existing/Init, choose **Create remote repository** on GitHub or Forgejo, then pick the **Owner**: your account, one of your organizations, or (Forgejo) a new organization created on the spot.

### Commands
Commands (push, pull, sync, fetch, commit, history, `.gitignore`) act on the repository that contains the active file, otherwise the one selected in the Source Control view; if that's ambiguous you'll be asked to pick one.

### Source Control View
- **Repo Selector**: Switch between configured repositories using the dropdown at the top.
- **Changes**: View staged, changed, and untracked files.
- **Actions**:
  - `+` to stage file.
  - `-` to unstage file.
  - `↩` to discard changes.
  - Click a file to view the Diff.

### GitHub Authentication
To create new repositories or access private ones:
1. Go to Settings > Folder Git.
2. Generate a [GitHub Personal Access Token](https://github.com/settings/tokens) (Classic with `repo` scope, or fine-grained with *Contents* and *Administration* write access).
3. Paste the token in the settings and click **Validate**.

### Forgejo Authentication
1. Go to Settings > Folder Git > Forgejo and enter your instance URL (e.g. `https://codeberg.org`).
2. On your Forgejo instance, open **Settings → Applications** and generate an access token with:
   - `repository`: Read and write
   - `user`: Read
   - `organization`: Read (to list your organizations), or Read and write (to create organizations and repositories in them)
3. Paste the token and click **Validate**.

HTTPS remotes whose host matches `github.com` or your Forgejo instance automatically use the matching token for push, pull, fetch and clone. SSH remotes use your SSH keys as usual.

> **Upgrading from 1.0.x:** older versions stored the GitHub token in a `.git-credentials` file inside the plugin folder and pointed each repo's `credential.helper` at it. Version 1.1.0 removes both automatically on startup.

## Development

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run dev` to start compilation in watch mode.
4. Copy `main.js`, `manifest.json`, `styles.css` to your test vault's plugin folder.

## License

MIT
