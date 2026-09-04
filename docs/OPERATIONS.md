# Operations

What to do when Aetheris AI misbehaves, and what has to be true before it is
run for people who are not you.

This document describes the system as it is actually implemented. Where
something is not implemented, it says so rather than describing an intention.

## At a glance

| | |
| --- | --- |
| Runtime | Next.js 16 on Node ≥ 22.6 |
| Database | PostgreSQL. Schema in `db/migrations/`, applied by `npm run migrate` |
| Model backends | Groq (default) or Gemini, selected by `LLM_PROVIDER`, with automatic failover to the other when it is configured |
| Embeddings | Local, in-process (`@xenova/transformers`). No external call |
| Health | `GET /api/health` — authenticated |
| Quality gates | `.github/workflows/ci.yml`: lint, typecheck, tests, production build, advisory `npm audit` |

## Deploying a change

```bash
npm ci
npm run check          # lint + typecheck + 415 tests
npm run migrate -- --status
npm run migrate        # only if that listed something pending
npm run build
```

Migrations are immutable once applied — the runner refuses to continue if a
file that has already run has been edited. Add a new migration instead.

Everything is server-rendered per request (a nonce-based CSP cannot be applied
to a page prerendered at build time), so there is no build-time page cache to
invalidate.

## Health and what "degraded" means

`GET /api/health`, signed in, returns:

```json
{
  "status": "ok",
  "database": "up",
  "databaseMs": 12,
  "model": { "provider": "groq", "id": "..." },
  "providers": [{ "provider": "groq", "state": "closed", "totalFailures": 0 }]
}
```

`status` is `degraded` when the database is unreachable **or** any model
backend's circuit is open. A `state` of `open` means that backend failed
enough (or failed permanently — a rejected key, an exhausted quota) that
requests are being sent to the other one instead; `retryInSeconds` says when
it will next be tried.

It is authenticated on purpose: it names which backends are failing, which is
reconnaissance an anonymous probe should not get. A load balancer's liveness
check should use `/`.

## Alerts worth having

None of these are wired up — there is no metrics backend chosen. They are the
signals the code already emits, and what each means.

| Signal | Where it comes from | Why it matters |
| --- | --- | --- |
| `status: degraded` from `/api/health` | poll it | Both model backends down means no lessons can start |
| `[api] route=… ms=…` p95 climbing | route logs | Every route logs its name, request id, user and duration |
| `[llm] provider=… outcome=failed kind=quota` | model calls | A spent quota is not transient; it needs a person |
| `[llm] provider=… outcome=skipped reason=circuit-open` | model calls | Failover is carrying the load; the primary is down |
| `[ingest …] slice failed` | ingestion | A document is failing to index; after `max_attempts` it stops |
| 429s from `route=…` | route logs | Either abuse or a limit set too low |
| 5xx with a `requestId` | error responses | Every 5xx carries an id that appears in the log line |

Logs are structured as `key=value` and deliberately carry **no** learner
content, prompt text or document text — only route, request id, user id,
timing and error kind.

## Incident playbooks

### Lessons will not start

1. `GET /api/health`. If `providers` shows every backend `open`, it is a
   provider problem, not yours.
2. `kind=quota` or `kind=auth` in the logs means a key or an allowance, not an
   outage: rotate or top up, then the circuit closes on its own after
   `openMs`.
3. If `database: down`, see below — lesson planning writes a session row and
   cannot proceed without it.

### The database is unreachable

1. Confirm from outside the app (`psql` with the same `DATABASE_URL`).
2. Certificate failures look like connection failures. TLS verification is on
   for every remote connection; if the provider rotated to a private CA, set
   `DATABASE_CA_CERT`. `DATABASE_SSL_INSECURE=true` is **refused in
   production** on purpose — it is not the fix.
3. Check the pool is not exhausted: `DATABASE_POOL_MAX` (10) per instance
   multiplied by the number of instances must stay under the provider's limit.

### A document will not index

Ingestion is a durable job. A failing one retries up to `max_attempts` and
then stops as `failed` rather than looping.

```sql
SELECT id, document_id, status, attempts, next_chunk_index, total_chunks, error
  FROM ingestion_jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20;
```

To retry one, set it back to `queued` and clear `attempts`. The checkpoint in
`next_chunk_index` means it resumes rather than starting over.

### A learner reports a wrong grade

Grades are evidence-backed. For the assessment:

```sql
SELECT results, score_percent, grader_version, rubric_version
  FROM lesson_quiz_attempts WHERE quiz_id = $1;
```

`results` holds each question, what the learner answered, the verdict and
whether it was reached deterministically or by rubric. For mid-lesson
checkpoints, `lesson_sessions.checkpoint_results` holds the same. If the
rubric has changed since, `rubric_version` says which one applied.

## Backups and restore

**Not configured by this repository.** The database is the only durable state
— there is no object storage and no file system state — so a managed
provider's point-in-time recovery is sufficient and is the recommended
approach.

What must be true before launch:

- Automated daily backups with point-in-time recovery enabled.
- **A restore drill actually performed**, into a scratch database, with
  `npm run migrate -- --status` run against the restored copy to confirm the
  schema version matches the deployed code. An untested backup is not a
  backup.
- Documented RPO/RTO. Nothing in the application assumes either.

## Retention and deletion

| Data | Lifetime | Removed by |
| --- | --- | --- |
| Uploaded documents, chunks, embeddings | Until deleted; `npm run retention` sweeps past `DOCUMENT_RETENTION_DAYS` (90) | The learner, from the setup screen; or the sweep |
| Lesson history and transcripts | Indefinite | Account deletion |
| Lesson sessions | Indefinite; superseded ones are marked `cancelled` | Account deletion |
| Quizzes and graded attempts | Indefinite | Account deletion |
| Logs | Whatever the host keeps | The host |

`npm run retention` is a dry run; `--apply` deletes. It is deliberately not
self-scheduled — where a recurring job runs is an infrastructure decision, and
a deletion sweep firing from whichever serverless instance happens to be warm
is not one worth having. Point a scheduler at it.

Account deletion (`DELETE /api/account`, from the profile screen) removes the
`users` row; everything else cascades from it. There is no soft delete and
nothing is retained.

## Rate limits and quotas

Per learner, per process: 60/min on database routes, 20/min on model routes,
**300/day across all model routes together**, 10/hour on uploads, and 5/hour
per client address on registration.

The counters live in process memory, so N instances means an effective limit
of up to N × the configured value. That is a deliberate, documented
simplification; `consume()` in `src/lib/security/rateLimit.ts` is the single
function to change for a shared store.

## Still to decide

These need a decision rather than an implementation:

1. **pgvector** — `db/optional/0001_pgvector.sql` is written and not applied.
2. **A multilingual embedding model** — invalidates every stored vector.
3. **Object storage and a real queue** — ingestion is durable and resumable,
   but its slices are driven by the client polling rather than by a worker.
4. **An email provider** — password reset and email verification cannot exist
   without one.
5. **A metrics/log backend** — the signals above are emitted; nothing collects
   them.
