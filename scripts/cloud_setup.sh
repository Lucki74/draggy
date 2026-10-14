#!/bin/bash
# Cloud-only: exit immediately on a laptop
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if [ ! -d node_modules ]; then
  npm ci || true
fi
exit 0
