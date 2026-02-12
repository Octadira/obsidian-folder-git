# Obsidian Folder Git

![GitHub release (latest by date)](https://img.shields.io/github/v/release/octadira/obsidian-folder-git)
![GitHub downloads](https://img.shields.io/github/downloads/octadira/obsidian-folder-git/total)

**Folder Git** is an Obsidian plugin that brings VS Code-style Git source control to your vault. Unlike other Git plugins that force a single repository for the entire vault, Folder Git allows you to manage **multiple independent Git repositories** for individual folders.

## Features

- **Multi-Repo Support**: Manage separate Git repositories for different folders within the same vault.
- **VS Code-Inspired UI**: Familiar Source Control panel with staged changes, commit input, and file status badges.
- **Git Operations**:
  - Stage/Unstage specific files or all changes.
  - Commit with message.
  - Push/Pull to remote.
  - View colored Diff for file changes.
  - View History log per repository.
- **GitHub Integration**:
  - Clone private repositories.
  - Initialize new repositories and publish to GitHub automatically.
  - Authentication via Personal Access Token.
- **Auto-Backup**: Configure auto-commit and auto-push intervals per repository.
- **Context Menu Integration**: Right-click folders to add them as repositories or open source control.

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
3. Create a folder in your vault: `.obsidian/plugins/obsidian-folder-git/`.
4. Copy the downloaded files into that folder.
5. Reload Obsidian and enable the plugin.

## Usage

### Adding a Repository
1. Click the **Folder Git: Add Folder Repository** command or use the ribbon icon.
2. Select the folder you want to track.
3. Choose a mode:
   - **Existing**: Use an existing `.git` repository in that folder.
   - **Init**: Initialize a new Git repository. Option to create a GitHub repo automatically.
   - **Clone**: Clone a repository from a URL into the folder.

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
2. Generate a [GitHub Personal Access Token](https://github.com/settings/tokens) (Classic) with `repo` scope.
3. Paste the token in the settings and click **Validate**.

## Development

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run dev` to start compilation in watch mode.
4. Copy `main.js`, `manifest.json`, `styles.css` to your test vault's plugin folder.

## License

MIT
