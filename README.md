<h1 align="center">github-board</h1>

<p align="center">
  <strong>A client-side kanban board for GitHub issues and pull requests, driven by a custom filter expression language.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/tomzxcode/github-board" alt="License"></a>
  <img src="https://img.shields.io/badge/JavaScript-ES2020%2B-yellow" alt="JavaScript ES2020+">
  <img src="https://img.shields.io/badge/platform-Web-lightgrey" alt="Platform">
</p>

## What

github-board is a single-page web app that turns any GitHub search (a repo, an org, a user, or a custom query) into a customizable board of issues and pull requests. You define columns and swimlanes with small expressions, and the board groups, sorts, and renders cards you can click through to GitHub. It is plain HTML, CSS, and JavaScript with no framework and no build step, so you can run it by opening `index.html`.

## Why

GitHub's issue and PR lists are flat and hard to organize across many items or many repos. Project boards exist inside GitHub, but they require manual triage and do not adapt to ad-hoc, expression-driven layouts. github-board lets you sketch a board in seconds against live data, tweak it live, and save the layout as a preset, all without leaving the browser or installing anything.

## Included

- Kanban-style board built from any GitHub search query (repo, org, user, or full search syntax)
- Configurable columns defined by filter expressions, with empty columns still visible
- Optional swimlanes (rows) for horizontal grouping by a second dimension
- Auto-splitting columns and swimlanes: a `$1` capture in a rule name expands into one bucket per distinct matched value (e.g. one column per `area:*` label)
- Custom boolean expression language with fields (type, state, labels, assignees, dates, etc.), operators (`==`, `=~`, `<`, `contains`, `in`, `exists`, `empty`), regex matching, and relative date math (`-7d`, `-2w`, `-1y`)
- Live preview and per-field validity indicators as you type filter, column, and lane expressions
- Card sorting within each cell by updated, created, number, title, or age
- GitHub GraphQL fetching with pagination (up to 2000 items) and a live rate-limit indicator
- Named presets that save the full configuration (query, filter, columns, swimlanes)
- Dark, responsive UI that works on mobile and desktop
- All config and the token persist in the browser's `localStorage`; requests go directly from your browser to GitHub

## Out of Scope

- No backend or server: the app is static and talks to the GitHub API from the browser only
- No write operations: github-board is read-only and never modifies your issues or pull requests
- No OAuth login flow: you bring your own personal access token
- No drag-and-drop editing of cards across columns; it is a view, not a project-management tool

## Requirements

- A modern web browser (Chrome, Firefox, Edge, or Safari)
- A GitHub personal access token (PAT) with read access to the repositories or organizations you want to view
- Node.js (only if you want to run the test suite, which uses the `jsdom` dev dependency)

## Install

Clone the repository:

```bash
git clone https://github.com/TomzxCode/github-board.git
cd github-board
```

There is no build step. To run the test suite (optional):

```bash
npm install
npm test
```

## Getting Started

1. Open `index.html` in your browser (double-click it, or serve the folder with any static server).
2. Paste a GitHub personal access token into the token field and click **Save**. The token is stored only in this browser and is sent only to `api.github.com`.
3. Open **&#9881; Settings** and enter a GitHub search query, for example:

   ```
   repo:owner/name
   ```

4. Click **Refresh** to load issues and pull requests.
5. The default board ships with Draft PRs, Open PRs, Open Issues, and Closed columns. Edit, add, remove, or reorder columns and swimlanes in Settings to match your workflow; the board re-renders live as you type.
6. Use **? Help** for the full expression reference, including how to auto-split a column with a `$1` capture group.
7. Save your layout as a preset with **Save current** to reuse it later.

## License

The code is licensed under the [MIT license](http://choosealicense.com/licenses/mit/). See [LICENSE](LICENSE).
