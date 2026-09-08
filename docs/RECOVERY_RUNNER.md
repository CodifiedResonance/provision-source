# Recovery runner handoff — candidate awaiting private account configuration

No runner has been deployed or smoke-tested. No backup/restore operation or secret injection has occurred. GitHub discovery returned eight accessible repositories, all public; no approved private operations repository was available. The connector exposes frontend code/PR/CI actions but no repository creation, protected-environment/secret configuration or workflow-dispatch action.

## Concrete candidate

Use one manually invoked `ubuntu-24.04` job in an owner-approved **private** operations repository. Review `recovery-smoke.yml` and `recovery-smoke.sh` here, then install them as `.github/workflows/recovery-smoke.yml` and `ops/recovery-smoke.sh` there. These files are inert in this frontend repo. Set `RECOVERY_REVIEWED_SHA` to the reviewed operations commit and `RECOVERY_POSTGRES_IMAGE` to a backend-reviewed compatible immutable image digest. Dispatch only that default-branch commit. The workflow rejects public repositories and other commits, uses no saved checkout credential, and references no secrets.

The smoke records CPU/RAM/disk and tool versions, starts an empty isolated PostgreSQL container with no network, verifies SQL and dump/restore binaries, probes staging HTTPS without authentication, and removes its container and disposable password. It neither restores data nor proves a full Supabase platform is compatible. Supabase CLI absence is reported explicitly. The backend agent must select the target image/extensions, tool version/checksum and capacity thresholds before a full rehearsal. Docker/PostgreSQL/Supabase remain absent from this chat runtime; the script has passed shell syntax validation only.

## Costs and protection that still require account verification

GitHub documents a private standard Linux runner as 2 CPU / 8 GB RAM / 14 GB SSD; public frontend CI has different capacity. We have not measured the private candidate. Standard private Linux usage is $0.006/minute after included allowance: at most $0.09 compute for this 15-minute smoke if billed at that rate, excluding storage, tax or account-specific terms. Run only within a verified included allowance unless spending is separately approved. [Runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

On Free/Pro/Team, required reviewers are documented as public-repository-only. Private environment secrets require Pro/Team/Enterprise; a named environment alone is not an approval control. Verify the actual plan before choosing a privileged workflow. Do not move secrets into a public repository to gain a gate. [Environment protections](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Ownership and credential mechanism

Proposed division, **not yet acknowledged by the backend agent**:

| Owner | Deliverable |
| --- | --- |
| Frontend/GitHub task | Pinned private workflow, runner capacity/connectivity evidence, reviewed-ref enforcement, least-privilege credential injection, cleanup and redacted logs |
| Supabase task | Compatible image/extensions; pinned backup/restore scripts; consistent snapshot and complete file verification; erasure replay; disabled restored delivery/schedules; pass/fail evidence and resource requirements |
| Account owner | Private repository/plan approval, protected environment or equivalent approved external secret-release gate, spending boundary and restricted encrypted artifact destination |

For the later privileged rehearsal, use short-lived credentials injected at runtime by an approved protected environment or an external secret broker bound to this repository, environment and reviewed commit. Put connections in mode-600 temporary files or process environment consumed by the backend scripts, never command arguments, Vite variables or repository files. Disable tracing and raw SQL/error dumps. Keep evidence bytes and backup files out of public logs/artifacts; encrypt before writing to approved restricted storage with a documented expiry, key custodian and deletion receipt. Revoke credentials and destroy the target after the run. None of these privileged steps is present in the no-secrets smoke.

The next account action is to expose an approved private operations repository and its plan/protection configuration. This candidate is ready to review; it is not evidence of a successful recovery rehearsal. No fallback purchase is justified until the smoke measures a concrete resource failure.
