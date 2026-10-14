#!/bin/bash
# Cloud-only: exit immediately on a laptop
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# The VM ships /opt/node24 but puts /opt/node22/bin first on PATH; repoint node, npm, npx at 24.
if [ -x /opt/node24/bin/node ] && [ -w /opt/node22/bin ]; then
  for b in node npm npx; do ln -sf "/opt/node24/bin/$b" "/opt/node22/bin/$b"; done
fi
echo "cloud_setup: node $(node -v 2>&1), want $(tr -dc '0-9.' < .nvmrc 2>/dev/null)" >&2
if [ ! -d node_modules ]; then
  # --ignore-scripts: postinstall binary downloads (onnxruntime-node, electron) are blocked or
  # unneeded for typecheck, lint and unit tests on the cloud VM.
  npm ci --ignore-scripts >&2 || echo "cloud_setup: npm ci FAILED, node_modules missing" >&2
fi
exit 0
