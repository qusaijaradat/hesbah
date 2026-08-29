#!/usr/bin/env bash
# Portainer stack driver — create/update/destroy a standalone Docker stack
# through the Portainer API, with an end-to-end health gate.
#
# A deploy names an exact image tag (never `latest`) and the script waits for
# the public URL to answer before declaring victory — so a failed rollout fails
# the pipeline instead of quietly leaving the environment down, and a rollback
# is just re-running the deploy workflow with an older tag.
#
# The CI runner never touches the Docker host directly: the host accepts no
# inbound SSH, so Portainer's API is the only way in.
#
# Usage:
#   portainer.sh deploy  <stack-name> <compose-file> <env-file> [health-url]
#   portainer.sh destroy <stack-name>
#   portainer.sh status  <stack-name>
#   portainer.sh prune   [repo-prefix]
#
# Environment:
#   PORTAINER_URL     e.g. https://portainer.example.com
#   PORTAINER_TOKEN   an API access token (X-API-Key)
#   PORTAINER_ENDPOINT_ID  optional; auto-detected when there is exactly one
#   PORTAINER_INSECURE=1   skip TLS verification (self-signed front door)
#   HEALTH_TIMEOUT    seconds to wait for the health URL (default 180)

set -euo pipefail

: "${PORTAINER_URL:?PORTAINER_URL is required}"
: "${PORTAINER_TOKEN:?PORTAINER_TOKEN is required}"

CURL_OPTS=(--silent --show-error --fail-with-body --max-time 120)
[[ "${PORTAINER_INSECURE:-0}" == "1" ]] && CURL_OPTS+=(--insecure)

# Every call goes through here so that a failure REPORTS WHAT PORTAINER SAID.
#
# This used to be a bare `curl` whose output the callers redirected to
# /dev/null — which also discarded the error body, so a rejected deploy
# surfaced in CI as `curl: (22) The requested URL returned error: 409` and
# nothing else. The status code alone does not distinguish "a stack with that
# name exists", "the stack is in a failed state" and "the compose file is
# invalid", and all three want different fixes.
#
# So the body is captured here and echoed to stderr on failure, no matter what
# the caller does with stdout.
api() {
  local method="$1" path="$2"; shift 2
  local out rc=0
  out="$(curl "${CURL_OPTS[@]}" -X "$method" \
    -H "X-API-Key: ${PORTAINER_TOKEN}" \
    -H "Content-Type: application/json" \
    "${PORTAINER_URL}${path}" "$@" 2>&1)" || rc=$?
  if (( rc != 0 )); then
    {
      echo "Portainer API ${method} ${path} failed (curl exit ${rc}):"
      # jq if it parses, raw otherwise — an HTML error page or a curl message
      # is still worth showing verbatim.
      jq -r '.message // .details // .' <<<"$out" 2>/dev/null || echo "$out"
      if [[ "$out" == *409* || "$out" == *"error: 409"* ]]; then
        echo
        echo "409 usually means the stack exists but is not in a state Portainer will update"
        echo "— most often a previous deploy that failed part-way. Inspect and remove it with:"
        echo "    $0 status  <stack-name>"
        echo "    $0 destroy <stack-name>"
        echo "then re-run this workflow; the stack is recreated from scratch."
      fi
    } >&2
    return "$rc"
  fi
  printf '%s' "$out"
}

resolve_endpoint() {
  if [[ -n "${PORTAINER_ENDPOINT_ID:-}" ]]; then
    echo "$PORTAINER_ENDPOINT_ID"; return
  fi
  local eps count
  eps="$(api GET /api/endpoints)"
  count="$(jq 'length' <<<"$eps")"
  if [[ "$count" -eq 0 ]]; then
    echo "no Portainer endpoints found" >&2; exit 1
  fi
  if [[ "$count" -gt 1 ]]; then
    echo "several endpoints exist; set PORTAINER_ENDPOINT_ID to one of:" >&2
    jq -r '.[] | "  Id=\(.Id)  Name=\(.Name)"' <<<"$eps" >&2
    exit 1
  fi
  jq -r '.[0].Id' <<<"$eps"
}

# Find a stack by name ON A GIVEN ENDPOINT.
#
# The endpoint filter is not optional. Portainer scopes stack NAMES per
# endpoint, so the same name can exist on two hosts at once — which is exactly
# what happens while moving environments between hosts. Matching on name alone
# finds the stack on the host you are moving AWAY from and then updates it with
# the new host's endpointId, so the deploy either fails with a mismatch or
# silently rewrites the old host's stack while reporting success against the
# new one.
stack_id_by_name() {
  local name="$1" eid="$2"
  api GET /api/stacks \
    | jq -r --arg n "$name" --argjson e "$eid" \
        '.[] | select(.Name == $n and .EndpointId == $e) | .Id' \
    | head -1
}

# Warn when the same stack name exists on OTHER endpoints. That is not an
# error — it is the normal, temporary state of a migration — but it is worth
# saying out loud, because the leftover keeps running, keeps its published
# ports, and keeps answering requests that the edge may still be sending it.
warn_other_endpoints() {
  local name="$1" eid="$2" others
  others="$(api GET /api/stacks \
    | jq -r --arg n "$name" --argjson e "$eid" \
        '[.[] | select(.Name == $n and .EndpointId != $e) | .EndpointId] | join(", ")')"
  [[ -n "$others" ]] && \
    echo "note: a stack named '${name}' also exists on endpoint(s) ${others}; it is still running there" >&2
  return 0
}

# Build the JSON `env` array Portainer expects from a KEY=VALUE file. Values
# are passed through jq rather than interpolated, so a secret containing
# quotes, backslashes or newlines cannot corrupt the request body.
env_json() {
  local file="$1"
  [[ -f "$file" ]] || { echo "[]"; return; }
  jq -Rn --rawfile raw "$file" '
    $raw
    | split("\n")
    | map(select(length > 0 and (startswith("#") | not)))
    | map(
        (index("=")) as $i
        | select($i != null)
        | { name: .[0:$i], value: .[$i+1:] }
      )
  '
}

wait_healthy() {
  local url="$1" timeout="${HEALTH_TIMEOUT:-180}" waited=0 code streak=0
  local settle="${HEALTH_SETTLE:-25}" need="${HEALTH_CONSECUTIVE:-3}"
  [[ -z "$url" ]] && { echo "no health URL given; skipping health gate"; return 0; }

  # Portainer returns as soon as it has ACCEPTED the stack, before Compose has
  # torn the old containers down. Polling immediately therefore gets a 200
  # from the OUTGOING container and reports a rollout healthy that has not
  # started yet — which is exactly what happened on the first run of this
  # script. Wait out the swap before believing anything.
  echo "letting the rollout start (${settle}s) before polling ${url}"
  sleep "$settle"

  # Then require several consecutive successes: a container that boots, throws,
  # and is restarted by Docker will answer 200 intermittently, and a single
  # lucky probe would call that a successful deploy.
  echo "waiting for ${url} — need ${need} consecutive 200s (timeout ${timeout}s)"
  while (( waited < timeout )); do
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)"
    if [[ "$code" == "200" ]]; then
      streak=$((streak + 1))
      if (( streak >= need )); then
        echo "healthy — ${need} consecutive 200s after ${waited}s"
        return 0
      fi
    else
      streak=0
    fi
    sleep 5; waited=$((waited + 5))
    printf '  %ss … status %s (streak %s/%s)\n' "$waited" "${code:-none}" "$streak" "$need"
  done
  echo "NOT healthy after ${timeout}s — last status ${code:-none}" >&2
  return 1
}

cmd_deploy() {
  local name="$1" compose="$2" envfile="$3" health="${4:-}"
  local eid sid body
  eid="$(resolve_endpoint)"
  sid="$(stack_id_by_name "$name" "$eid")"
  warn_other_endpoints "$name" "$eid"

  body="$(jq -n \
    --arg name "$name" \
    --rawfile content "$compose" \
    --argjson env "$(env_json "$envfile")" \
    '{name: $name, stackFileContent: $content, env: $env}')"

  if [[ -n "$sid" ]]; then
    echo "updating existing stack '${name}' (id=${sid}) on endpoint ${eid}"
    # pullImage:true so a moved tag is actually re-pulled; prune:true so a
    # service removed from the compose (the demo `seed`, say) is really gone
    # rather than left running from the previous definition.
    jq -n --argjson b "$body" \
      '{stackFileContent: $b.stackFileContent, env: $b.env, prune: true, pullImage: true}' \
      | api PUT "/api/stacks/${sid}?endpointId=${eid}" --data-binary @- > /dev/null
  else
    echo "creating stack '${name}' on endpoint ${eid}"
    api POST "/api/stacks/create/standalone/string?endpointId=${eid}" \
      --data-binary "$body" > /dev/null
  fi

  echo "stack '${name}' submitted"
  wait_healthy "$health"
}

cmd_destroy() {
  local name="$1" eid sid
  eid="$(resolve_endpoint)"
  sid="$(stack_id_by_name "$name" "$eid")"
  if [[ -z "$sid" ]]; then
    echo "stack '${name}' does not exist — nothing to destroy"
    return 0
  fi
  echo "deleting stack '${name}' (id=${sid})"
  api DELETE "/api/stacks/${sid}?endpointId=${eid}" > /dev/null
  echo "deleted"
}

# Images this project pushed. Nothing outside this prefix is ever deleted by
# name — see cmd_prune.
PRUNE_REPO_PREFIX_DEFAULT="ghcr.io/qusaijaradat/hesbah"

# Reclaim disk on the Docker host: this project's own images that nothing is
# using, plus dangling layers.
#
# The host is only reachable through Portainer's Docker API proxy, so this is
# the Engine API rather than `docker` — which matters for one specific reason,
# below.
#
# Two rules keep this from becoming a host-wide wipe:
#
#   1. Only images whose REPOSITORY starts with the given prefix are deleted by
#      name. Another stack's images on the same VPS are never candidates, even
#      when they are unused.
#   2. An image referenced by ANY container is kept — `all=1`, so stopped ones
#      count too. A stopped container is something someone can still start, and
#      its image is not ours to remove.
#
# Everything else this project pushed goes, including tags behind the deployed
# one. Rolling back to a pruned tag still works: portainer.sh deploys with
# pullImage:true, so Docker fetches it from the registry again.
cmd_prune() {
  local prefix="${1:-$PRUNE_REPO_PREFIX_DEFAULT}"
  local eid containers images doomed count filters resp
  eid="$(resolve_endpoint)"

  containers="$(api GET "/api/endpoints/${eid}/docker/containers/json?all=1")"
  images="$(api GET "/api/endpoints/${eid}/docker/images/json")"

  # Image ids to delete, with the tags they carry, for the log.
  doomed="$(jq -n --argjson imgs "$images" --argjson cts "$containers" --arg pfx "$prefix" '
    # What any container points at, by id and by the reference it was created
    # from — a container can name either, so both are treated as "in use".
    ([$cts[].ImageID] | map(select(. != null))) as $usedIds
    | ([$cts[].Image]  | map(select(. != null))) as $usedRefs
    | [ $imgs[]
        | . as $img
        | (($img.RepoTags // []) | map(select(. != "<none>:<none>"))) as $tags
        | select($tags | length > 0)
        # Repository is the tag minus its final :label. A label cannot contain
        # / or :, so this is unambiguous even for a registry with a port.
        | select($tags | any(sub(":[^:/]+$"; "") | startswith($pfx)))
        | select(($usedIds | index($img.Id)) == null)
        # $t is bound before the pipe on purpose: inside `$usedRefs | index(.)`
        # the dot is the array, so index() would search it for ITSELF — and on
        # arrays index() matches a subsequence, so it finds one at position 0
        # and quietly rejects every candidate.
        | select($tags | any(. as $t | $usedRefs | index($t) != null) | not)
        | { id: $img.Id, tags: $tags }
      ]
  ')"

  count="$(jq 'length' <<<"$doomed")"
  echo "images matching ${prefix}* and used by no container: ${count}"

  # Deleted one at a time rather than through the prune endpoint, because the
  # prune endpoint cannot express "only this repository" — it is all-or-nothing
  # across the host.
  while read -r id tags; do
    [[ -z "$id" ]] && continue
    echo "  removing ${tags}"
    # Never forced. If Docker still considers an image in use, its refusal is a
    # safety net worth keeping, and one stubborn image must not abort the rest.
    api DELETE "/api/endpoints/${eid}/docker/images/${id}" > /dev/null 2>&1 \
      || echo "    skipped — Docker refused (still referenced)"
  done < <(jq -r '.[] | "\(.id) \(.tags | join(","))"' <<<"$doomed")

  # Then untagged leftovers, host-wide. These belong to no repository by
  # definition — superseded layers from a moved tag, or an interrupted pull.
  #
  # `dangling=true` is passed EXPLICITLY and must stay that way. The CLI
  # defaults to dangling-only, but this API does the opposite: with no filter
  # it prunes every unused image on the endpoint, which would take other
  # stacks' images with it.
  filters="$(jq -rn '({dangling:{"true":true}} | tojson) | @uri')"
  resp="$(api POST "/api/endpoints/${eid}/docker/images/prune?filters=${filters}")"
  jq -r '"dangling layers reclaimed: \(((.SpaceReclaimed // 0) / 1048576) | floor) MB"' <<<"$resp"
}

# Deliberately NOT endpoint-filtered: when you are asking where a stack is,
# the copy on the other host is the answer you are looking for.
cmd_status() {
  local name="$1"
  api GET /api/stacks \
    | jq -r --arg n "$name" '.[] | select(.Name == $n) | "Id=\(.Id) Name=\(.Name) EndpointId=\(.EndpointId) Status=\(.Status)"'
}

case "${1:-}" in
  deploy)  shift; cmd_deploy  "$@" ;;
  destroy) shift; cmd_destroy "$@" ;;
  status)  shift; cmd_status  "$@" ;;
  prune)   shift; cmd_prune   "$@" ;;
  *) echo "usage: $0 {deploy|destroy|status|prune} …" >&2; exit 2 ;;
esac
