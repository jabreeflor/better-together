---
description: Post a comment to the host's room, anchored to the most recent host turn (watch mode only).
argument-hint: "<message>"
disable-model-invocation: true
---

Run this command via the Bash tool, then print its output verbatim to the user with no additional commentary:

```
bt comment "$ARGUMENTS"
```

If exit code is non-zero, show stderr verbatim. Do not interpret or summarize.
