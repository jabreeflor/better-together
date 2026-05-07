---
description: Disconnect a watcher from the current hosting session by display name.
argument-hint: "<display-name>"
disable-model-invocation: true
---

Run this command via the Bash tool, then print its output verbatim to the user with no additional commentary:

```
bt kick "$ARGUMENTS"
```

If exit code is non-zero, show stderr verbatim. Do not interpret or summarize.
