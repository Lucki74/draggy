#!/bin/bash
# PreToolUse hook: for test commands, keep the full log on disk and print only failure lines.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command')
if [[ "$cmd" =~ ^(npm test|npm run test|npm run check)([[:space:]]|$) ]]; then
  log="${TMPDIR:-/tmp}/draggy-test.log"
  filtered="{ $cmd; } > '$log' 2>&1; rc=\$?; grep -A 5 -E '(FAIL|ERROR|[Ee]rror)' '$log' | head -100; echo \"exit=\$rc (full log: $log)\"; exit \$rc"
  echo "$input" | jq --arg f "$filtered" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:(.tool_input+{command:$f})}}'
else
  echo "{}"
fi
