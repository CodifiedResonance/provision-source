#!/usr/bin/env bash
set -euo pipefail
set +x
# Capability rehearsal only: this file never connects to an existing database.
[[ "${RECOVERY_POSTGRES_IMAGE:-}" =~ ^(docker.io/library/postgres|postgres|supabase/postgres)@sha256:[a-f0-9]{64}$ ]] || {
  echo 'Backend-reviewed PostgreSQL image digest is required.' >&2
  exit 1
}
for command_name in git docker curl openssl; do command -v "$command_name" >/dev/null; done
git --version
docker version --format 'Docker client {{.Client.Version}} / server {{.Server.Version}}'
getconf _NPROCESSORS_ONLN
free -m
df -m "$RUNNER_TEMP"
if command -v supabase >/dev/null; then supabase --version; else echo 'Supabase CLI absent; full platform rehearsal remains unproven.'; fi
docker pull "$RECOVERY_POSTGRES_IMAGE" >/dev/null
smoke_dir="$(mktemp -d "$RUNNER_TEMP/provision-smoke.XXXXXX")"
smoke_container="provision-smoke-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
cleanup() {
  docker rm -fv "$smoke_container" >/dev/null 2>&1 || true
  rm -f "$smoke_dir/password"
  rmdir "$smoke_dir" || true
}
trap cleanup EXIT
# Disposable local password: never a staging/Production credential.
openssl rand -hex 32 > "$smoke_dir/password"
chmod 644 "$smoke_dir/password"
# The parent directory stays mode 700; read-only mount is available to image postgres.
docker run --detach --name "$smoke_container" --network none \
  --memory 2g --cpus 1 --pids-limit 256 \
  --mount "type=bind,src=$smoke_dir/password,dst=/run/secrets/smoke-password,readonly" \
  --env POSTGRES_PASSWORD_FILE=/run/secrets/smoke-password \
  --env PGDATA=/var/lib/postgresql/data/smoke \
  --tmpfs /var/lib/postgresql/data:rw,size=512m \
  "$RECOVERY_POSTGRES_IMAGE" >/dev/null
ready=false
for attempt in {1..30}; do
  if docker exec "$smoke_container" pg_isready -q -U postgres; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable database did not become ready.' >&2; exit 1; }
docker exec "$smoke_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc 'select version(); select 1;'
docker exec "$smoke_container" pg_dump --version
docker exec "$smoke_container" pg_restore --version
# Unauthenticated TLS reachability only. No response body or headers are logged.
http_status="$(curl --proto '=https' --max-time 20 --silent --show-error --output /dev/null --write-out '%{http_code}' https://qaaskvbhssonbktdjdki.supabase.co/auth/v1/health)"
[[ "$http_status" =~ ^[234][0-9][0-9]$ ]] || { echo 'Staging HTTPS reachability failed.' >&2; exit 1; }
echo "Staging HTTPS responded: $http_status. Database connectivity and restore semantics NOT tested."
