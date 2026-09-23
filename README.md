# Folder Git

![GitHub release (latest by date)](https://img.shields.io/github/v/release/Octadira/obsidian-folder-git)
![GitHub downloads](https://img.shields.io/github/downloads/Octadira/obsidian-folder-git/total)
![License](https://img.shields.io/github/license/Octadira/obsidian-folder-git)

**Folder Git** brings VS Code-style Git source control to Obsidian. Unlike plugins that treat the whole vault as a single repository, Folder Git lets you manage **multiple independent Git repositories, one per folder**. It works with **GitHub** and **Forgejo / Gitea** (including [Codeberg](https://codeberg.org) and self-hosted instances).

## Features

- **One repository per folder.** Track any number of folders (or the vault root) as separate Git repositories, each with its own remote, branch and backup schedule.
- **Source Control panel.** Repository list with change indicators, current branch with ahead/behind counts, and staged, changed, untracked and conflicted files.
- **Everyday Git operations.**
  - Stage, unstage and discard individual files or everything at once. Discarding always asks for confirmation.
  - Commit staged changes, or stage everything and commit in one click. Press `Ctrl/Cmd+Enter` to commit. An empty message falls back to the repository's commit template.
  - Push, pull, **sync** (pull then push) and fetch. The first push sets the upstream branch automatically.
  - Colored diffs for working-tree and staged changes.
  - Mark merge conflicts as resolved.
- **History view.** Browse recent commits per repository and open the diff of any file changed in a commit.
- **GitHub and Forgejo integration.**
  - Validate an access token and see which account is connected.
  - Create a new remote repository while adding a folder: under your account or one of your organizations, private or public.
  - Forgejo: create a new organization from the same dialog.
  - Clone private repositories over HTTPS.
- **Auto-backup.** Per-repository auto-commit interval, commit message template (`{{date}}` placeholder) and auto-push.
- **`.gitignore` tools.** Built-in `.gitignore` editor, plus *Add to / Remove from .gitignore* in the file explorer context menu.
- **Context menu.** Right-click a folder to add it as a repository. On a repository root folder you can open Source Control or History, pull, push, or edit `.gitignore`.

## Requirements

- Obsidian **1.7.2** or later, **desktop only** (Windows, macOS, Linux).
- **Git** installed and available on your `PATH`, or its location set in the plugin settings.

## Installation

### From Community Plugins (recommended)

1. Open **Settings → Community plugins** and turn off *Restricted mode* if needed.
2. Select **Browse** and search for **Folder Git**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Octadira/obsidian-folder-git/releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/folder-git/`.
3. Reload Obsidian and enable **Folder Git** in **Settings → Community plugins**.

## Getting started

### Add a repository

1. Run **Folder Git: Add folder repository** from the command palette, or right-click a folder and choose **Git: add repository**.
2. Select the folder to track.
3. Choose a mode:
   - **Use existing repo**: the folder already contains a `.git` repository. Its remote is detected automatically.
   - **Initialize new repo**: runs `git init` in the folder.
   - **Clone from URL**: clones into a new subfolder, or directly into the selected folder if it is empty.
4. Optionally, for *existing* or *new* repositories, choose **Create remote repository** on GitHub or Forgejo. Then pick the **Owner**: your account, one of your organizations, or (on Forgejo) a new organization.
5. Select **Add repository**.

### Source Control view

Open it from the ribbon icon or with **Folder Git: Open source control**.

- Click a repository in the list to switch to it. The dot and counter show pending changes.
- Header buttons: **Refresh**, **Pull**, **Push**, **Sync**, and a **⋯** menu with Fetch, Open history, Edit `.gitignore` and Add folder repository.
- On each file: `+` stages, `−` unstages, `↩` discards, and the file icon opens the note. Click the row to view its diff, or right-click for more actions.

### Commands

| Command | Description |
| --- | --- |
| Open source control | Open the Source Control panel |
| Open Git history | Open the History view for a repository |
| Add folder repository | Start tracking a folder |
| Commit (active repo) | Focus the commit message box |
| Commit all changes with default message (active repo) | Stage everything and commit using the template (and push if auto-push is on) |
| Push / Pull / Sync / Fetch (active repo) | Network operations |
| Edit .gitignore | Open the `.gitignore` editor |

The *active repo* is the one containing the file you are editing. Otherwise it is the one selected in the Source Control panel. If that is still ambiguous, you are asked to pick one.

## Authentication

Tokens are only needed to **create remote repositories** and to **push, pull or clone over HTTPS**. SSH remotes keep using your SSH keys and need no token.

### GitHub

1. Create a [personal access token](https://github.com/settings/tokens):
   - Classic token: `repo` scope. Add `read:org` if you want your private organization memberships listed.
   - Fine-grained token: *Contents* and *Administration* read and write permissions on the repositories it should manage.
2. In **Settings → Folder Git → GitHub**, paste the token and select **Validate**.

### Forgejo / Gitea / Codeberg

1. In **Settings → Folder Git → Forgejo**, enter your instance URL, for example `https://codeberg.org` or `https://git.example.com`.
2. On your instance, open **Settings → Applications** and generate an access token with:
   - `repository`: read and write
   - `user`: read
   - `organization`: read (to list your organizations), or read and write (to also create organizations)
3. Paste the token and select **Validate**.

## Privacy and security

- **Where tokens are stored.** Tokens are saved in the plugin's `data.json` inside your vault (`.obsidian/plugins/folder-git/`). If you sync or commit your `.obsidian` folder, exclude that file.
- **How tokens are used.** Tokens are passed to Git **in memory only** (via environment variables and a temporary credential helper), during push, pull, fetch and clone. They are only used for HTTPS remotes whose host matches `github.com` or your Forgejo instance. They are never written to `.git/config`, credential files or remote URLs.
- **Network access.** The plugin only contacts `api.github.com` and the Forgejo instance you configure, plus the Git remotes of your repositories.
- **Local changes.** The plugin runs Git commands in the folders you add and edits `.gitignore` files when you ask it to.
- **Plain `http://` instances.** A Forgejo instance on `http://` receives your token unencrypted, and the plugin warns you when you validate one.

> **Upgrading from 1.0.x:** earlier versions stored the GitHub token in a `.git-credentials` file and pointed each repository's `credential.helper` at it. Version 1.1.0 removes both automatically.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| *"… is not a Git repository root"* | The selected folder must contain its own `.git` directory. Use *Initialize new repo* or pick the repository's top folder. |
| Git not found | Install Git, or set **Git binary path** in settings (reload the plugin afterwards). |
| Push asks for credentials or fails with 401/403 | Validate the matching token in settings and check its permissions. For other hosts, use SSH or your system's Git credential manager. |
| *"No commits yet — commit before pushing"* | Make the first commit before pushing. |
| Organizations are not listed | Grant the token organization read access (Forgejo) or `read:org` (GitHub classic), then press the reload button next to **Owner**. |

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and release process, and [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
