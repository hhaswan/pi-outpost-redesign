#!/usr/bin/env bash
# Refuse to publish credentials. Scans what a push would add (default: @{u}..HEAD).
# Live secrets are read at run time from this host's files and never printed.
# Test fixtures under server/test/fixtures/ are allowed (publicly committed, test-only).
# Install as a pre-push hook: ln -sf ../../scripts/check-no-secrets.sh .git/hooks/pre-push
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# As a pre-push hook git passes <remote> <url>, and the refs on stdin: not a range.
range="${1:-}"
[[ "$(basename "$0")" == pre-push || "${2:-}" == *://* || "${2:-}" == *@*:* ]] && range=""
if [[ -z "$range" ]]; then
  if [[ ! -t 0 ]] && read -r _ local_sha _ remote_sha; then
    # pre-push stdin: <local ref> <local sha> <remote ref> <remote sha>
    zero=0000000000000000000000000000000000000000
    [[ "$local_sha" == "$zero" ]] && exit 0
    if [[ "$remote_sha" == "$zero" ]]; then range="$local_sha"; else range="$remote_sha..$local_sha"; fi
  else
    range="@{u}..HEAD"
  fi
fi
diff="$(mktemp)"; trap 'rm -f "$diff"' EXIT
git log -p --no-color "$range" -- . ':(exclude)server/test/fixtures/**' > "$diff"
fail=0

# 1. Live secrets of this host: server tokens (config and its backups), TLS private keys, provider keys.
secrets() {
  for f in /root/pi-outpost.config.json /root/pi-outpost.config.json.* "${PI_OUTPOST_CONFIG:-}"; do
    [[ -f "$f" ]] && node -e 'try{const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).server?.token;if(t)console.log(t)}catch{}' "$f"
  done
  for f in "$HOME"/.config/pi-outpost/tls/*.key; do [[ -f "$f" ]] && sed -n '2p' "$f"; done
  [[ -f "$HOME/.pi/agent/auth.json" ]] && node -e 'try{const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const v of Object.values(a))for(const k of ["key","access","refresh","apiKey"])if(typeof v?.[k]==="string")console.log(v[k])}catch{}' "$HOME/.pi/agent/auth.json"
  [[ -f "$HOME/.git-credentials" ]] && sed -n 's#^https://[^:]*:\([^@]*\)@.*#\1#p' "$HOME/.git-credentials"
  return 0
}
n=0
while IFS= read -r value; do
  n=$((n + 1))
  [[ ${#value} -lt 16 ]] && continue
  if grep -qF -- "$value" "$diff"; then echo "check-no-secrets: live secret #$n of this host is in $range" >&2; fail=1; fi
done < <(secrets)

# 2. Credential-shaped strings outside test fixtures (added lines only).
if grep -nE '^\+' "$diff" | grep -vE 'not-a-real|fixture-no-model|test-offline|probe-token|https-login-probe' \
  | grep -qE -- '-----BEGIN [A-Z ]*PRIVATE KEY|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'; then
  echo "check-no-secrets: credential-shaped string added outside server/test/fixtures/ in $range" >&2
  grep -nE '^diff --git|^\+.*(-----BEGIN [A-Z ]*PRIVATE KEY|sk-ant-|ghp_|github_pat_|AKIA|xox[baprs]-|AIza)' "$diff" | grep -B1 '^[0-9]*:+' | sed -E 's/(:\+.{0,40}).*/\1…/' >&2 || true
  fail=1
fi

# 3. Files that must never be committed.
if git diff --name-only "${range%%..*}" "${range##*..}" 2>/dev/null | grep -E '(^|/)(ca|server)\.key$|(^|/)sessions\.json$|(^|/)auth\.json$|\.git-credentials$|(^|/)\.env$' ; then
  echo "check-no-secrets: a credential file is part of $range" >&2; fail=1
fi

[[ $fail -eq 0 ]] && echo "check-no-secrets: clean ($range)"
exit $fail
