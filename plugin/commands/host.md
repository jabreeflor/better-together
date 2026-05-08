---
description: Start a Better Together hosting session, exposing your Claude Code session via a shareable URL.
argument-hint: "[--accept]"
disable-model-invocation: true
---

## Step 1 — Decide whether to prompt for the disclosure

If `$ARGUMENTS` already contains `--accept`, skip to Step 3.

Otherwise, run this Bash check to see whether the disclosure has been accepted before:

```
test -f ~/.claude/plugins/data/better-together/.disclosure-accepted && echo ACCEPTED || echo NEEDS_DISCLOSURE
```

If the output is `ACCEPTED`, skip to Step 3.

## Step 2 — Prompt the user (only when output was `NEEDS_DISCLOSURE` and `--accept` is absent)

Use the `AskUserQuestion` tool with exactly this question and these options:

- **question**: `Start a Better Together hosting session? Anyone with the room URL will see, in real time, your prompts to Claude, Claude's responses, every tool call and its arguments, file diffs from edits, command output, and permission prompts you receive. Comments left by watchers persist in the room transcript. Treat the room URL like a Zoom link: anyone with it is in. Run /better-together:end to close the room.`
- **header**: `Start room?`
- **multiSelect**: `false`
- **options**:
  - `{ "label": "Yes, start hosting", "description": "Records the disclosure as accepted and starts the room." }`
  - `{ "label": "No, cancel", "description": "Aborts. No room is started, no state is changed." }`

If the user chooses **"No, cancel"** (or "Other" with a negative answer), output the single line `Aborted.` and stop. Do not run `bt host`.

If the user chooses **"Yes, start hosting"**, set `$ARGUMENTS` to `--accept` and proceed to Step 3.

## Step 3 — Run the CLI

Run this command via the Bash tool, then print its output verbatim to the user with no additional commentary:

```
bt host $ARGUMENTS
```

If exit code is non-zero, show stderr verbatim. Do not interpret, summarize, or paraphrase. The CLI's output is the user-facing surface.
