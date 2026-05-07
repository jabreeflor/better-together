---
description: Watch a Better Together host's session as a plugin watcher. Their transcript becomes context for your local Claude.
argument-hint: "<url>"
disable-model-invocation: true
---

Run this command via the Bash tool, then print its output verbatim to the user with no additional commentary:

```
bt watch "$ARGUMENTS"
```

If exit code is non-zero, show stderr verbatim. Do not interpret or summarize.
