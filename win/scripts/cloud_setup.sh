#!/bin/bash
# Cloud-only: exit immediately on a laptop
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
echo "cloud_setup: node $(node -v 2>&1)" >&2
if [ ! -d node_modules ]; then
  # --ignore-scripts: postinstall binary downloads (onnxruntime-node, electron) are blocked or
  # unneeded for typecheck, lint and unit tests on the cloud VM.
  npm ci --ignore-scripts >&2 || echo "cloud_setup: npm ci FAILED, node_modules missing" >&2
fi
exit 0
