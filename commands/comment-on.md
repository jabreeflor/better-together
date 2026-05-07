---
description: Post a comment anchored to a specific turn id in the host's room (watch mode only).
argument-hint: "<turn-id> <message>"
disable-model-invocation: true
---

Run this command via the Bash tool, then print its output verbatim to the user with no additional commentary:

```
bt comment-on $ARGUMENTS
```

If exit code is non-zero, show stderr verbatim. Do not interpret or summarize.
