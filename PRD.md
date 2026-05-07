# Better Together — PRD v0.2

**Status:** Draft, post-design-session
**Owner:** Jabree Flor
**Last updated:** 2026-05-06
**Supersedes:** v0.1 (peer-symmetric model)

---

## TL;DR

Better Together is a Claude Code plugin that turns a single agent session into a shareable, witnessable, comment-able room. One person hosts and drives; teammates join by URL — either in a browser or in their own Claude Code as a watcher with a private analyst Claude alongside the stream. Hosting is ephemeral and zero-config: Cloudflare quick-tunnels expose the host's local server, no accounts, no infra, no central service. The product targets small trusted groups doing pairing, mentoring, code review, or async "show me what you tried" workflows.

The earlier symmetric-multi-Claude model (v0.1) was abandoned after a design pass — parallel agents acting on shared infrastructure creates merge conflicts and tool-call races that no coordinator can resolve cleanly without becoming a single-driver model with extra steps. v0.2 commits to asymmetry: one driver, many witnesses, with comments as the feedback channel.

---

## Problem

Coding agents are single-player. Real software work isn't. Pairing, mentoring, review, and async knowledge-transfer are all shapes of collaboration that exist independent of AI, and AI-driven coding sessions are no less valuable to share than human-driven ones — arguably more, because the agent's reasoning and tool calls are much more visible than a human's would be. GitHub Next's Ace prototype validates that there's interest in collaborative agent workspaces. Nothing equivalent exists for Claude Code, which has the largest active terminal-agent user base.

There's a secondary problem the product also addresses: agent sessions are currently lost the moment they end. Even for a single user, the ability to scrub back through a session — see why a tool call was made, what the agent was reasoning about at a specific point — is a better experience than re-reading a log file. The lobby UI is incidentally a better viewing surface than Claude Code's native scrollback, even for the host.

---

## Goals

1. **Two-minute setup.** Two strangers should be able to go from "never heard of this" to "in a shared room watching one of them work" in under two minutes, with no account creation on either side.
2. **Self-hosted ethos.** No SaaS dependency for the room itself. The "server" is a process on the host's machine, exposed by an ephemeral tunnel. When the host closes Claude Code, the room ends.
3. **Witnessable agent sessions.** Browser viewers see the host's session unfold in real time — prompts, responses, tool calls, file diffs — with full fidelity, not just summaries.
4. **Plugin watchers get a private analyst.** Teammates running Claude Code with the plugin can attach a watch mode that pipes the host's transcript into their own local Claude as live context. They can ask their Claude questions about the host's session without disturbing it.
5. **Anchored comments as side-channel feedback.** Watchers can leave comments pinned to specific turns. Comments do not auto-inject into the host's model context; the host reads them out-of-band and decides whether to act on them.

---

## Non-goals (v1)

- **Multiple drivers.** Exactly one person drives at a time. The room is the host's session, witnessed.
- **Persistent rooms / replay archive.** Rooms end when the host closes Claude Code. Transcript can be downloaded as JSON before that, but there's no "rewatch last week" feature.
- **Shared compute / shared filesystem.** Each teammate's Claude Code lives in their own shell. The host's tools execute on the host's machine; nobody else's environment is touched.
- **Watch-mode Claudes participating in the host's session.** A plugin watcher's local Claude is a private analyst, not a participant. Anything it concludes stays in the watcher's terminal unless the watcher explicitly comments.
- **Browser-side AI assistance.** Browser viewers see the stream; they don't get an embedded Claude alongside it. If they want analyst capabilities, they install the plugin.
- **Production-grade auth, multi-tenancy, rate limiting.** The single-host ephemeral model sidesteps these for v1. Out of scope until a persistent-room version earns it.
- **Mobile-native experience.** The browser lobby should be readable on a phone screen, but interaction (commenting, rewinding) is desktop-first in v1.

---

## Target users

Small trusted groups, 2–6 people, with at least one Claude Code user (the host). Common shapes:

- A senior dev mentoring a junior, where the junior watches the senior's agent session and asks follow-up questions in their own watch-mode Claude.
- Two friends pairing on a side project, one driving with their agent while the other watches and leaves suggestions.
- A team showing the rest of the org "here's what I'm exploring" — the rest of the team watches via browser, no install required.
- Async "here's what I tried, take a look later" — though this stretches the v1 model since the room is ephemeral; it works only if the host stays online.

Non-users in v1: anyone who needs persistence, anyone who needs to drive without installing Claude Code, anyone collaborating across a hostile network where Cloudflare quick-tunnels are blocked.

---

## Core concepts

**Room.** A live, ephemeral space tied to one host's Claude Code session. Has a unique URL, lives until the host closes Claude Code or hits `/team:end`. State is held by the host's local server in memory.

**Driver.** The host. The one person whose Claude Code is the room's session. Has full edit/drive capabilities. There is exactly one driver per room and the role does not transfer in v1.

**Watcher (plugin).** A teammate who runs `/team:watch <url>` from their own Claude Code. Their plugin subscribes to the host's transcript stream and exposes it to their local Claude as reference context. They can ask their local Claude questions about the host's session, and they can post anchored comments back to the host.

**Watcher (browser).** A teammate who opens the room URL in a browser. Sees the live transcript, presence, and comment thread. Can post comments. No analyst Claude attached.

**Comment.** A text annotation pinned to a specific turn in the host's transcript. Authored by any watcher (plugin or browser). Visible in the lobby for everyone in the room. Surfaced to the host as a side-channel notification in their Claude Code terminal but never automatically injected into the host's model context.

**Tunnel.** A Cloudflare quick-tunnel spawned by the host's plugin, exposing the local server on a randomly assigned `*.trycloudflare.com` URL. No account, no DNS, no setup. Tunnel ends with the room.

---

## User flows

### Hosting

1. Jabree runs `/team:host` in Claude Code.
2. Plugin checks for `cloudflared`, offers to install via Homebrew if missing, then spawns the local server (Node + Express + WS) on a free port and starts a quick-tunnel pointed at it.
3. Plugin prints the resulting URL to the terminal and copies it to the clipboard. Shows a one-line "share this URL with anyone you want in the room."
4. Plugin attaches itself to the host's session and begins streaming transcript events to the local server. From here, every prompt, response, tool call, and file edit fans out to anyone connected.
5. When Jabree types `/team:end` (or quits Claude Code), the plugin tears down the tunnel, kills the local server, and notifies any connected watchers that the room has closed.

Total setup time on a fresh machine: ~30 seconds (after `cloudflared` install). On a machine that already has it: ~5 seconds.

### Joining as a browser watcher

1. Bob receives the URL via Slack/text/whatever.
2. He clicks. The lobby loads in his browser, prompts for a display name on first join, then drops him into the live room.
3. He sees the session transcript streaming in real time — past turns scrollable, new turns appearing live, tool calls expanding to show diffs and command outputs.
4. He can scrub back through earlier turns, leave anchored comments, and see other watchers' presence and comments.
5. When he closes the tab he's gone. No state lingers.

### Joining as a plugin watcher

1. Bob receives the URL.
2. He runs `/team:watch <url>` in his own Claude Code.
3. His plugin connects to the host's tunnel, subscribes to the transcript stream, and registers a `host_session` context block in his local session that updates as the host works.
4. He can ask his own Claude things like "what's Jabree trying to do?" or "is that approach likely to work?" — his Claude has the host's transcript as reference and answers without anyone else seeing.
5. He can post anchored comments back to the host's room with `/team:comment <message>` (anchors to most recent host turn) or `/team:comment-on <turn-id> <message>`.
6. He can also open the lobby in browser if he wants the visual surface. Plugin and browser modes are complementary, not exclusive.

### Commenting

Any watcher (plugin or browser) can leave comments. Comments require an anchor — they point at a specific turn or tool call in the transcript. The lobby UI shows them inline next to the turn they reference. The host sees a small notification badge in their Claude Code terminal showing pending unread comments; they can `/team:comments` to read them all in their terminal, or just glance at the lobby. Comments are advisory: the host decides whether to share them with their Claude (by manually quoting or paraphrasing into a prompt) or ignore them entirely.

---

## System design

### Components

**Plugin** (`@better-together/plugin`). A standard Claude Code plugin bundling slash commands, hooks, an MCP server config, and a local Node process the plugin spawns when needed.

- **Drive mode** (`/team:host`): spawns the local server, spawns the tunnel, hooks into the host's session events.
- **Watch mode** (`/team:watch <url>`): connects to a remote room, maintains a live context block in the watcher's local session.
- **Slash commands**: `host`, `end`, `watch`, `unwatch`, `comment`, `comment-on`, `comments`, `pulse`.
- **Hooks**: `UserPromptSubmit`, `PostToolUse`, `Stop` — relay session events to the local server (drive mode) or no-op (watch mode).

**Local server** (Node + Express + ws). Runs on the host's machine when drive mode is active.

- HTTP endpoints: `/health`, static lobby at `/ui`, transcript snapshot at `/snapshot.json`.
- WebSocket at `/ws`: bidirectional. Server pushes transcript events, presence updates, and comments. Clients post comments and presence heartbeats.
- MCP endpoint at `/mcp` (optional, plugin watchers use it for the analyst-context wiring): tools to fetch transcript, fetch comments, post comment.
- In-memory state: current transcript (append-only), connected watchers, comments, presence.

**Lobby UI** (single-file HTML, served by local server).

- Three-pane layout: transcript (center, primary), presence and active watchers (right), comment thread (collapsible, anchored to selected turn).
- Live updates via WebSocket. Optimistic local rendering for the watcher's own comments.
- Visual treatment: terminal-aesthetic (mono font, dark, high contrast) — matches Claude Code's vibe and signals "this is a developer tool."

**Tunnel** (cloudflared, child process of the local server).

- Spawned by the plugin in quick-tunnel mode.
- Plugin parses cloudflared's stdout to capture the assigned URL.
- Auto-restarts on failure during the room's lifetime.
- Killed cleanly on `/team:end`.

### Data model

- **Transcript event**: `{ id, ts, kind: "user" | "assistant" | "tool_call" | "tool_result" | "system", payload, room_id }`. Append-only, ordered.
- **Comment**: `{ id, ts, author, text, anchor_event_id, room_id }`. Pinned to a transcript event.
- **Presence**: `{ user_id, display_name, mode: "host" | "plugin-watcher" | "browser-watcher", last_seen_ts, room_id }`.
- **Room**: `{ id, host_user_id, started_at, tunnel_url }`.

All state is in-memory on the host. No database. When the host's process ends, state is gone.

### Identity

Each plugin install generates a stable random `user_id` on first run, persisted locally. The lobby prompts for a display name on first join per room (browser watchers) or pulls it from plugin config (plugin watchers). No central identity service. No authentication beyond "you have the URL, you're in." Trust model is the same as a Zoom link.

For URLs that might leak, the host can optionally pass `--secret` to `/team:host`, which adds a join-secret param. Watchers without it get a "this room requires a secret" prompt. Defer to v2 unless dogfood reveals a need.

---

## Privacy & safety

The host's session contains everything in their local context: code, file paths, error messages, half-formed thoughts to their Claude. Sharing a room means sharing all of that with whoever's in the room. This isn't a bug, it's the product, but the UX needs to make it obvious.

- **Pre-host disclosure.** First time a user runs `/team:host`, the plugin shows a one-time confirmation: "Everyone with this URL will see your prompts, your Claude's responses, file edits, and command output until you end the session. Continue?"
- **Visible watcher list.** The host's terminal always shows a small "watching: N" indicator. Tapping or running `/team:who` lists names. The host should never lose track of who's in the room.
- **Redaction filter (defer to v1.5).** A regex list in plugin config that strips matching content from outgoing transcript events. Defaults to common secret patterns (`API_KEY=...`, AWS access keys, etc.). Not in v1 because it's hard to get right and worse-than-nothing if it gives false confidence.

The host can `/team:kick <name>` to forcibly disconnect a watcher. Comments from a kicked user remain in the transcript (they're already history) but no new ones land.

---

## Success criteria

**Quantitative (after first month of use):**

- Jabree has hosted at least 5 sessions with at least one other watcher.
- At least 2 sessions have run longer than 30 minutes (indicating sustained value, not just novelty).
- At least 3 distinct watchers have joined a room (someone besides the same one friend).

**Qualitative:**

- "Watching someone else's Claude session" feels useful, not voyeuristic, in at least one real workflow Jabree does regularly (mentoring, pairing, demoing).
- The 2-minute setup target holds in practice with a non-technical co-conspirator.
- Comments-as-side-channel feels right. If watchers consistently want to "talk to the host's Claude directly," that's a signal v1 is too restrictive and v2 needs more.

If by week 4 Jabree isn't reaching for `/team:host` at least once a week unprompted, v1 didn't earn its existence.

---

## Open questions

1. **Token-by-token streaming vs. per-turn?** v1 ships with per-turn (each message appears whole when complete). Token streaming is more "alive" but creates an intimacy and bandwidth cost worth deferring.
2. **Tool-call approval visibility.** Should watchers see "host is being asked to approve `rm -rf node_modules`" with a ticking timer? It's compelling for liveness but exposes the host's hesitation in a way that might feel surveilling. Lean toward yes for v1 but make it dismissible.
3. **Comment anchoring granularity.** Anchor to whole turns (simpler) or to specific lines/tokens within a turn (more useful for code review)? v1 ships turn-level; if dogfood shows reviewers wanting more, upgrade.
4. **What happens when the host's tunnel flaps?** Cloudflare quick-tunnels are reliable but not bulletproof. If the URL changes mid-session, watchers are stranded. Investigate whether cloudflared can preserve URL across reconnects in quick-tunnel mode; if not, this is a real limitation worth surfacing.

---

## v2 roadmap (not committed, just plausible)

- **Driver handoff.** Allow the floor to pass between plugin participants. Hard problems (tool-call coordination, transcript consistency) deferred until v1 proves the room model works.
- **Persistent rooms.** Long-running NAS-hosted server with the same protocol. Rooms survive host disconnects. Replay-anytime.
- **Watch-mode Claude as participant.** Currently a private analyst; v2 could allow opt-in "publish my analysis to the room" so a watcher's reasoning becomes visible to others without giving them tool authority.
- **Granular context redaction.** Better-than-regex filtering for what leaves the host's machine.
- **Mobile lobby.** Real touch-optimized viewer.

---

## Appendix: what changed from v0.1

v0.1 imagined a peer-symmetric model where every plugin install could host or join, and joiners had their own Claudes participating in a shared room. The design pass that produced v0.2 surfaced a fundamental problem: parallel Claudes acting on shared infrastructure (files, shells, tool approvals) creates merge conflicts and tool-call races that have no clean resolution. Any coordinator that resolves them ends up serializing access to a single driver, at which point the symmetric model is just an asymmetric model with extra plumbing.

v0.2 embraces the asymmetry explicitly. The host drives, others witness. The "everyone has their own Claude" idea is preserved in the form of plugin-watch-mode, where each watcher's Claude is a private analyst over the host's session — engaged, intelligent, but with no write authority anywhere shared. This keeps the value proposition (multiple Claudes engaged with the same problem) while sidestepping the coordination problems (only one Claude touches anything that has side effects).

The plugin-as-peer architecture is preserved: any install can be the host on any given day. What's not preserved is the idea that all participants are simultaneously equal in a single room. The room has a host. The role doesn't move in v1.
