# Contributing to Folder Git

Thanks for your interest in improving Folder Git! Bug reports, feature requests and pull requests are welcome.

## Reporting issues

Please [open an issue](https://github.com/Octadira/obsidian-folder-git/issues) and include:

- Obsidian version and operating system
- Plugin version
- Git version (`git --version`) and whether the remote is GitHub, Forgejo/Gitea or something else
- Steps to reproduce, what you expected and what happened
- Any error shown in the notice or in the developer console (`Ctrl/Cmd+Shift+I`)

**Never paste access tokens** in issues, logs or screenshots.

## Development setup

1. Clone the repository into `<your test vault>/.obsidian/plugins/folder-git/` (or copy the build output there).
2. Install dependencies: `npm install`
3. Start the watcher: `npm run dev`
4. Reload Obsidian (or use the Hot Reload plugin) to pick up changes.

Use a test vault — the plugin runs Git commands that change files on disk.

## Before opening a pull request

- `npx eslint .` passes with no errors.
- `npx tsc --noEmit` passes.
- `npm run build` succeeds.
- UI text uses sentence case (enforced by the linter).
- User-facing changes are listed under a new version heading in `CHANGELOG.md`.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.ts` | Plugin entry point: commands, context menus, refresh timer |
| `src/repoRegistry.ts` | All Git operations (one `simple-git` instance per folder) |
| `src/hosting/` | GitHub and Forgejo API clients and credential matching |
| `src/views/` | Source Control and History views, diff modal |
| `src/modals/` | Add repository, `.gitignore` editor, confirmations, repo picker |

## Releasing (maintainers)

1. Bump `version` in `manifest.json` and `package.json`, and add the version to `versions.json` with its `minAppVersion`.
2. Add a `## <version>` section to `CHANGELOG.md`.
3. Commit, then push a tag that matches the version exactly (no `v` prefix), e.g. `git tag 1.1.0 && git push origin 1.1.0`.

The release workflow builds the plugin, attests the build provenance, and publishes the release with notes taken from `CHANGELOG.md`.
