# Changelog

## 1.1.2

### Changed
- Read the process environment through the Node `process` module instead of `globalThis` (popout-window compatibility guideline).
- Remove an unnecessary type assertion flagged by Obsidian's automated review.

## 1.1.1

### Security
- Update `simple-git` to 3.36 to address a published vulnerability advisory (affected versions < 3.32.0).

### Changed
- Environment variables such as `EDITOR`, `PAGER`, `GIT_SSH_COMMAND` or `SSH_ASKPASS` keep working with the updated `simple-git` (whose new safety checks would otherwise block every Git command); they are honoured exactly as when running Git from a terminal.
- Resolve all code-quality warnings reported by Obsidian's automated review (type-safe access to Node APIs, timer usage).

## 1.1.0

### Added
- **Forgejo / Gitea support** (including Codeberg and self-hosted instances): validate an access token, create remote repositories (personal or in an organization) and push/pull/clone private repositories over HTTPS.
- Choose where to create the remote repository (GitHub or Forgejo) when adding a folder, for both new and existing repositories.
- Owner picker listing your organizations (with a warning where you lack permission to create repositories); on Forgejo you can also create a new organization directly from the dialog.
- Sync (pull then push) and Fetch actions, as buttons and commands.
- Commit with `Ctrl/Cmd+Enter`; an empty message uses the repository's commit template.
- Per-file diffs for past commits in the History view.
- Mark merge conflicts as resolved from the Source Control view.
- Clone into a new subfolder.
- Built-in `.gitignore` editor (Obsidian does not show dotfiles, so the previous approach could not open the file).

### Changed
- Tokens are no longer written to a `.git-credentials` file or to `.git/config`. They are handed to Git in memory, only for the matching host, during network operations. Files and settings left by 1.0.x are removed automatically.
- Commands act on the repository of the active file, then the one selected in Source Control, and otherwise ask which repository to use (previously they always used the first repository).
- Discarding changes now asks for confirmation.
- Minimum Obsidian version is now 1.7.2.

### Fixed
- Commit message being cleared by the periodic status refresh.
- Push command doing nothing when the Source Control view was closed.
- Remote URL and auto-commit interval changes in settings not taking effect until restart.
- Custom Git binary paths containing spaces (e.g. `C:\Program Files\Git\...`) being rejected.
- Auto-commit racing with manual operations (`index.lock` errors).
- Unstage failing before the first commit; pull failing on branches without an upstream.

## 1.0.4
- Fix PAT naming.

## 1.0.3
- Resolve ESLint errors and automated scan issues.
