#!/usr/bin/env bash
# Build and verify this fork, then deploy outside the live service's process group.
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
config="${1:?Usage: bash scripts/update-custom-native.sh /absolute/config.json [/absolute/previous-config.json]}"
[[ "$config" = /* && -f "$config" ]] || { echo 'Configuration must be an existing absolute path.' >&2; exit 1; }
# Optional: the file the running service was started with, when this restart changes its
# transport or token (the HTTPS cutover). The idle check talks to the running server with it.
previous=()
if [[ -n "${2:-}" ]]; then
  [[ "$2" = /* && -f "$2" ]] || { echo 'Previous configuration must be an existing absolute path.' >&2; exit 1; }
  previous=(--previous-config "$2")
fi
[[ "$(id -u)" = 0 ]] || { echo 'Native systemd deployment requires root.' >&2; exit 1; }
export HOME="${HOME:-/root}"
cd "$repo"
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit or stash local changes before deploying.' >&2; exit 1; }
[[ ! -d .local/native-deploy.lock ]] || { echo 'Another deployment owns .local/native-deploy.lock; inspect its owner before retrying.' >&2; exit 1; }
if systemctl is-active --quiet pi-outpost-custom-deploy.service; then
  echo 'A custom deployment is already running.' >&2
  exit 1
fi
node="$(command -v node)"
export PATH="$(dirname "$node"):$PATH"
npx -y npm@12.2.2 ci
# npm ci can keep a stale half-installed node-pty; the web terminal then fails silently.
"$node" -e 'require("node-pty")' || { echo 'node-pty does not load: remove node_modules/node-pty and run npm ci again.' >&2; exit 1; }
"$node" cli/scripts/build.mjs
npm run check:custom-build
"$node" --test scripts/check-agent-images.test.mjs
"$node" scripts/check-image-prompt.mjs
"$node" scripts/check-ui-layout-copy.mjs
"$node" scripts/check-responsive.mjs --strict-touch
"$node" scripts/check-image-lightbox.mjs
"$node" scripts/check-update-notice.mjs
"$node" scripts/check-tab-sessions.mjs
"$node" scripts/check-refresh-restore.mjs
"$node" scripts/check-start-screen.mjs
"$node" scripts/check-session-tree.mjs
"$node" scripts/check-new-chat-confirm.mjs
"$node" scripts/check-shared-session.mjs
"$node" scripts/check-https-login.mjs
"$node" scripts/check-extension-hyperlinks.mjs
"$node" --test scripts/deploy-tls-preflight.test.mjs
"$node" scripts/check-agent-manager.mjs
"$node" scripts/check-native-deploy.mjs
"$node" --import tsx --test server/test/update.test.ts server/test/update-command-process.test.mjs server/test/piPackagesUpdate.test.ts extensions/cli-session-bridge.test.ts server/test/cliBridge.test.ts server/test/sessionSync.test.ts server/test/cli-bridge-wire.test.mjs server/test/sharedSessionWire.test.mjs server/test/subagentPackageAccept.test.ts
"$node" scripts/deploy-custom-native.mjs "$config" --check "${previous[@]}"
port="$("$node" -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).server.port)' "$config")"
systemd-run --unit=pi-outpost-custom-deploy --collect \
  --property="WorkingDirectory=$repo" \
  --property="ExecStopPost=\"$node\" \"$repo/scripts/native-deploy-network.mjs\" unlock $port" \
  --setenv="PATH=$PATH" --setenv="HOME=$HOME" \
  --setenv="PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" \
  "$node" "$repo/scripts/deploy-custom-native.mjs" "$config" "${previous[@]}"
printf '%s\n' 'Deployment queued. It waits for idle sessions before restarting.' \
  'Status: systemctl status pi-outpost-custom-deploy.service' \
  "Result: $repo/.local/deploy-result.json"
