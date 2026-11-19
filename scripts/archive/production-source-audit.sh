#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${KARIM_TEST_BASE:-http://127.0.0.1:5000}"
USER_NAME="${KARIM_TEST_USER:-admin}"
PASSWORD="${KARIM_TEST_PASSWORD:-}"
if [[ -z "$PASSWORD" ]]; then
  echo "KARIM_TEST_PASSWORD is required" >&2
  exit 2
fi

login_payload=$(printf '{"username":"%s","password":"%s"}' "$USER_NAME" "$PASSWORD")
login_json=$(curl -fsS -H 'Content-Type: application/json' -d "$login_payload" "$BASE_URL/api/auth/login")
token=$(printf '%s' "$login_json" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[[ -n "$token" ]] || { echo 'FAIL: login token missing'; exit 1; }

auth=(-H "Authorization: Bearer $token")
users_json=$(curl -fsS "${auth[@]}" "$BASE_URL/api/users?limit=5")
if printf '%s' "$users_json" | grep -q '"password"'; then
  echo 'FAIL: password field exposed by users endpoint'
  exit 1
fi

state_code=$(curl -sS -o /tmp/karim-state-audit.json -w '%{http_code}' "${auth[@]}" "$BASE_URL/api/state")
if [[ "$state_code" != '200' && "$state_code" != '404' ]]; then
  echo "FAIL: unexpected state status $state_code"
  exit 1
fi
if grep -qE '"(inventory|revenues|expenses|users|dispatches)"' /tmp/karim-state-audit.json 2>/dev/null; then
  echo 'FAIL: business entity returned from app_state'
  exit 1
fi

prefs_payload='{"lang":"ar","theme":"dark","inventory":[{"id":"must-not-persist"}]}'
write_code=$(curl -sS -o /tmp/karim-state-write-audit.json -w '%{http_code}' "${auth[@]}" -H 'Content-Type: application/json' -d "$prefs_payload" "$BASE_URL/api/state")
[[ "$write_code" == '200' ]] || { echo "FAIL: preferences write status $write_code"; exit 1; }
read_back=$(curl -fsS "${auth[@]}" "$BASE_URL/api/state")
if printf '%s' "$read_back" | grep -q 'must-not-persist'; then
  echo 'FAIL: app_state accepted a business entity'
  exit 1
fi

rm -f /tmp/karim-state-audit.json /tmp/karim-state-write-audit.json
printf '%s\n' 'Production PostgreSQL-source audit: PASS'
