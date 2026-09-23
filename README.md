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
- **Auto-backup.** Per-repository auto-commit interval, commit message template (`{{date}}` placeholder) and auto-push after every commit.
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

## Settings

**General**

| Setting | Default | Description |
| --- | --- | --- |
| Git binary path | *(empty)* | Path to the `git` executable. Leave empty to use the one on your `PATH`. Takes effect after reloading the plugin. |
| Show untracked files | On | Show untracked files in the Source Control panel. |
| Status refresh interval | 30 s | How often `git status` runs for each repository. `0` turns auto-refresh off. |

**Per repository** (under *Configured repositories*)

| Setting | Description |
| --- | --- |
| Remote URL | Applied to the repository's remote when you leave the field. |
| Auto-push after commit | Push after every commit made from the plugin, manual or automatic. On by default when the repository has a remote. |
| Auto-commit interval | Minutes between automatic *stage all + commit*. `0` disables it. |
| Commit message template | Used by auto-commit and when the commit message is empty. `{{date}}` becomes the current ISO date. |
| Remove | Stops tracking the folder. The `.git` folder and your files are left untouched. |

## Authentication

Tokens are only needed to **create remote repositories** and to **push, pull or clone over HTTPS**. SSH remotes keep using your SSH keys and need no token.

### GitHub

1. Create a [personal access token](https://github.com/settings/tokens):
   - Classic token: `repo` scope. Add `read:org` if you want your private organization memberships listed.
   - Fine-grained token: *Contents* and *Administration* read and write permissions. To create new repositories the token needs access to **All repositories**. For organization repositories, set the organization as the token's *Resource owner*.
2. In **Settings → Folder Git → GitHub**, paste the token and select **Validate**.

### Forgejo / Gitea / Codeberg

1. In **Settings → Folder Git → Forgejo**, enter your instance URL, for example `https://codeberg.org` or `https://git.example.com`.
2. On your instance, open **Settings → Applications** and generate an access token with:
   - `repository`: read and write
   - `user`: read
   - `organization`: read (to list your organizations), or read and write (to also create organizations)
3. Paste the token and select **Validate**.

## Privacy and security

### Where tokens are stored

Tokens are saved **unencrypted** in the plugin's settings file: `<vault>/.obsidian/plugins/folder-git/data.json`. Anything that copies that file copies your tokens.

- **Vault root as a repository.** *Commit all* and auto-commit stage everything, including `.obsidian/`. When you add the vault root as a repository, the plugin adds `.obsidian/plugins/folder-git/data.json` to the vault's `.gitignore` (unless Git already ignores it). It also warns you if the file is already committed; in that case run `git rm --cached` on it and revoke the tokens if you pushed it.
- **Other sync tools.** Obsidian Sync (when *Installed community plugins* sync is on), iCloud, Dropbox and similar tools copy `data.json` to your other devices. Exclude the file, or accept that the token lives there too.
- **Least privilege.** Use a fine-grained or narrowly scoped token with an expiry date, and revoke it if the file ever leaks.

### How tokens are used

- **API calls.** When you validate a token, create a repository or organization, or list organizations, the token is sent in the `Authorization` header to `api.github.com` or to `<your Forgejo instance>/api/v1`. It is never put in a URL.
- **Git operations.** During push, pull, sync, fetch and clone, the token is handed to that one Git process through environment variables. A credential helper passed on the command line (`-c credential.helper=…`) reads them. Nothing is written to `.git/config`, to a credentials file or to the remote URL.
- **Host matching.** A token is only offered to an `https://` remote whose host (and port) exactly matches `github.com` or your Forgejo instance. Other remotes never see it.
- **Other credential helpers.** For matching hosts, the plugin's helper replaces any configured helper (such as Git Credential Manager or the macOS keychain) for that command. For every other host, your normal Git configuration applies.
- **No prompts.** Network operations run with `GIT_TERMINAL_PROMPT=0`, so Git fails instead of waiting for a password it cannot ask for.
- **Process environment.** While a network operation runs, the token is in the Git process's environment. Other programs running as your user could read it there.
- **SSH remotes** use your SSH keys and agent. The plugin never sends a token over SSH.

### Plain `http://`

Tokens are never sent to `http://` remotes, with one exception. If you configure a Forgejo instance on `http://`, its `http://` remotes receive the token unencrypted, and the plugin warns you when you validate it.

### Network access

The plugin only connects to `api.github.com`, the Forgejo instance you configure, and the Git remotes of your repositories. There is no telemetry, analytics or update check.

### Local changes

- The plugin runs Git only in the folders you add, plus `git clone` into the folder you choose.
- It writes `.gitignore` only when you use the `.gitignore` editor or the *Add to / Remove from .gitignore* actions.
- Git runs with your environment, so variables such as `GIT_SSH_COMMAND`, `EDITOR` or `GIT_ASKPASS` apply exactly as they do in a terminal.

### Upgrading from 1.0.x

Versions up to 1.0.4 stored the GitHub token in a plaintext `.git-credentials` file in the plugin folder and pointed each repository's `credential.helper` at it. From 1.1.0 on, the plugin deletes that file when it loads and removes that `credential.helper` entry from each repository when it opens it.

If that file was ever synced, backed up or committed, **revoke the old token** and create a new one.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| *"… is not a Git repository root"* | The selected folder must contain its own `.git` directory. Use *Initialize new repo* or pick the repository's top folder. |
| Git not found | Install Git, or set **Git binary path** in settings (reload the plugin afterwards). |
| Push asks for credentials or fails with 401/403 | Validate the matching token in settings and check its permissions. For other hosts, use SSH or your system's Git credential manager. |
| *"No commits yet — commit before pushing"* | Make the first commit before pushing. |
| Push fails on a host that matches your token, even though Git Credential Manager has valid credentials | For matching hosts only the plugin's token is used. Validate a working token, or switch the remote to SSH. |
| Organizations are not listed | Grant the token organization read access (Forgejo) or `read:org` (GitHub classic), then press the reload button next to **Owner**. |

## Limitations

- Desktop only. Git runs as an external process, which Obsidian mobile does not support.
- There is no UI for branches. The plugin works on the current branch; use Git in a terminal to create or switch branches.
- Merge conflicts are resolved by editing the files. The plugin can only mark them as resolved (stage).
- The History view shows the last 50 commits.
- Tokens can be stored for one GitHub account and one Forgejo instance. Other HTTPS hosts rely on your system's Git credential setup.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and release process, and [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
