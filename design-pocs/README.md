# Lobby UI design POCs

Five distinct directions for the Better Together lobby UI, generated via the `frontend-design` skill against identical sample data (the "Jabree reviewing PRD privacy section" session). Open each in a browser, click around (each has a working anchor-selection interaction so you can see how comments tie to turns), and pick one. The chosen file becomes the starting point for `server/lobby.html`.

| # | Direction | Vibe | File |
|---|---|---|---|
| 01 | **Terminal Pure** | "this is a developer tool, no apologies" — the entire lobby dressed as a tmux session with bordered panes, gutter line numbers, `├─/└─` tree-rendered tool params, vim-style `── VISUAL ──` selection state, and `[H]/[B]/[P]` bracketed role tags. No emoji, no avatars, no rounded corners. | [01-terminal-pure.html](./01-terminal-pure.html) |
| 02 | **CRT Cyberpunk** | "demoscene meets dev tool" — phosphor-CRT terminal with full-screen scanlines, vignette, role-coded neon panels (magenta host / cyan watchers / green system), amber klaxon-pulsing permission prompt, T-numbered gutter IDs, blinking magenta caret on the live edge. | [02-crt-cyberpunk.html](./02-crt-cyberpunk.html) |
| 03 | **Stream Watcher** | "you're watching someone work like a livestream" — single elevated "stage" card framing the live-edge turn like a Twitch video player, backlog as a "Now Playing" filmstrip, urgent permission banner with marching diagonal stripes, color-coded chat column with anchor chips. | [03-stream-watcher.html](./03-stream-watcher.html) |
| 04 | **Document Margin** | "session as a literate document with marginalia" — serif two-column layout at magazine reading width, Google-Docs-style sticky-note comments in the right margin with dashed leader lines on hover, tool calls as left-accented call-out blocks, light theme. | [04-document-margin.html](./04-document-margin.html) |
| 05 | **PR Review** | "code review as the metaphor for collaboration" — GitHub PR aesthetic with tabs (Conversation / Files Changed / Commits / Reviewers), turns as commit-cards with kind-pills, Read tool as green-gutter file diff, Bash tool as terminal block, permission prompt as pulsing red CI failure, comments as collapsible review threads. | [05-pr-review.html](./05-pr-review.html) |

## How to evaluate

```bash
open design-pocs/01-terminal-pure.html
open design-pocs/02-crt-cyberpunk.html
open design-pocs/03-stream-watcher.html
open design-pocs/04-document-margin.html
open design-pocs/05-pr-review.html
```

For each, look at:
1. **First impression** — does it feel like a tool you'd reach for?
2. **Information hierarchy** — is the live edge obvious? Is the permission-prompt loud enough? Is the comment-anchor relationship legible?
3. **Tone match** — does it match Better Together's positioning ("small trusted groups, witnessable agent sessions")?
4. **Density** — at 6 turns + 4 comments + 4 watchers, the lobby is barely populated. Imagine 30+ turns and ~12 comments. Does the design scale?
5. **Skinnability** — could this design be light-themed if needed? Could it be tweaked without throwing the whole thing out?

Tell me which one (or which combination of elements) to take forward.
