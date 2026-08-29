#!/usr/bin/env bash
# One-time setup for the non-production side of the deployment.
#
# Creates the `preview-net` Docker network and deploys the shared
# `hesbah-nonprod` stack (preview-router + preview-db) that every dev and
# preview environment attaches to. Safe to re-run: the network is created only
# if missing, and re-deploying the stack just updates it in place.
#
# Run this ONCE before the first push to develop or the first pull request,
# from a machine that can reach Portainer:
#
#   export PORTAINER_URL=https://portainer.example.com
#   export PORTAINER_TOKEN=…
#   deploy/scripts/bootstrap-nonprod.sh
#
# Optional, all defaulted to what docker-compose.yml uses locally:
#   NONPROD_POSTGRES_USER      (postgres)
#   NONPROD_POSTGRES_PASSWORD  (ChangeMe_DevOnly!)
#   ROUTER_PORT                (5174 — the port the *.<base-domain> wildcard
#                               vhost already points at)

set -euo pipefail

: "${PORTAINER_URL:?PORTAINER_URL is required}"
: "${PORTAINER_TOKEN:?PORTAINER_TOKEN is required}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../.." && pwd)"

CURL_OPTS=(--silent --show-error --fail-with-body --max-time 60)
[[ "${PORTAINER_INSECURE:-0}" == "1" ]] && CURL_OPTS+=(--insecure)

api() {
  local method="$1" path="$2"; shift 2
  curl "${CURL_OPTS[@]}" -X "$method" \
    -H "X-API-Key: ${PORTAINER_TOKEN}" \
    -H "Content-Type: application/json" \
    "${PORTAINER_URL}${path}" "$@"
}

resolve_endpoint() {
  if [[ -n "${PORTAINER_ENDPOINT_ID:-}" ]]; then echo "$PORTAINER_ENDPOINT_ID"; return; fi
  local eps count
  eps="$(api GET /api/endpoints)"
  count="$(jq 'length' <<<"$eps")"
  if [[ "$count" -ne 1 ]]; then
    echo "set PORTAINER_ENDPOINT_ID — found ${count} endpoints:" >&2
    jq -r '.[] | "  Id=\(.Id)  Name=\(.Name)"' <<<"$eps" >&2
    exit 1
  fi
  jq -r '.[0].Id' <<<"$eps"
}

eid="$(resolve_endpoint)"

# `attachable` is what lets a separately deployed stack join this network.
# Without it, every environment stack fails at "network preview-net not found"
# in a way that reads like the network is missing rather than unusable.
if api GET "/api/endpoints/${eid}/docker/networks/preview-net" >/dev/null 2>&1; then
  echo "network preview-net already exists"
else
  echo "creating network preview-net on endpoint ${eid}"
  api POST "/api/endpoints/${eid}/docker/networks/create" --data-binary @- >/dev/null <<'JSON'
{"Name": "preview-net", "Driver": "bridge", "Attachable": true, "CheckDuplicate": true}
JSON
  echo "created"
fi

umask 077
env_file="$(mktemp)"
trap 'rm -f "$env_file"' EXIT
cat > "$env_file" <<EOF
NONPROD_POSTGRES_USER=${NONPROD_POSTGRES_USER:-}
NONPROD_POSTGRES_PASSWORD=${NONPROD_POSTGRES_PASSWORD:-}
ROUTER_PORT=${ROUTER_PORT:-}
EOF

# No health URL: this stack has no public hostname of its own. Its router
# answers 503 for any host it has no environment for, which is the correct
# response and not something to gate a deploy on.
"${here}/portainer.sh" deploy hesbah-nonprod "${repo}/deploy/compose/nonprod-shared.yml" "$env_file"

cat <<'DONE'

Done. Point the edge reverse proxy's wildcard vhost at this host:

  *.<base-domain>  ->  http://<docker-host>:5174   (dev + PR previews)
  <base-domain>    ->  http://<docker-host>:5173   (production)

where <base-domain> is the value of the HESBAH_BASE_DOMAIN GitHub variable.

forwarding X-Forwarded-Proto: https on both.
DONE
