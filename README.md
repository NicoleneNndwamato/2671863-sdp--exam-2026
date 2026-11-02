# Meridian — ARL Operations Console

A telemetry, alerting, control, and replay console for the Radio Telescope Array (RTA), Local Weather Monitoring (LWM), and Observatory Power Generation (OPG). The visual identity is **dark red**, with neutral light/dark surfaces and a separate brighter red for critical faults—not a navy theme.

## Packages

| Workspace | Responsibility |
| --- | --- |
| [@sdp/api](packages/api/package.json) | Fastify/TypeScript API, MQTT ingestion, PostgreSQL/Drizzle persistence, ARL researcher verification, alerts, audit records, and scan reconstruction. |
| [@sdp/web](packages/web/package.json) | React/Vite console: service dashboards, topology-driven controls, annunciator, researchers, audit log, and replay. |
| [@sdp/shared](packages/shared/package.json) | Shared TypeScript contracts only; no runtime service or separate build/test script. |

Data flows from MQTT through the API into PostgreSQL; the browser polls same-origin `/api` endpoints. The implemented service registry contains RTA, LWM, and OPG, not the simulator's additional MHE/OWT services.

## Prerequisites and installation

- Node.js **20 or newer** and npm with workspace support; CI uses Node 20.
- Docker Engine with Compose v2 for local PostgreSQL/MQTT and the optional simulator, or equivalent externally provisioned services.
- A POSIX shell for the combined development script. Automated broker tests need permission to open a loopback TCP port.

Run commands from the repository root unless shown otherwise:

```sh
npm ci
cp -n .env.example packages/api/.env
```

The copy does not overwrite an existing file. **Review the selected environment before starting anything.** API workspace scripts and Drizzle load `packages/api/.env` through dotenv; they do not automatically load the root `.env`. Exported environment variables take precedence. Never commit environment files or credentials.

### Environment

Use [.env.example](.env.example) as the template and [the API validator](packages/api/src/env.ts) as the source of defaults. Fill its blank address/port fields: empty strings do not activate defaults.

| Setting | Local value / purpose |
| --- | --- |
| `DATABASE_URL` | `postgres://arl:arl@localhost:5432/arl` for root Compose. Use a separate provisioned URL for hosted PostgreSQL/Neon. |
| `DATABASE_SSL` | `false` locally; `true` enables TLS for the API's PostgreSQL pool. Drizzle takes its connection settings from the URL, so configure migration TLS there too. |
| `ARL_API_ADDRESS`, `ARL_API_PORT` | `http://localhost`, `8080` for the simulator. Address includes the scheme but not the port or trailing slash. |
| `MQTT_BROKER_ADDRESS`, `MQTT_BROKER_PORT` | `localhost`, `1883`; use a hostname without a URL scheme. |
| `MQTT_BROKER_USER`, `MQTT_BROKER_PASSWORD` | Empty for the provided anonymous local broker; privately supplied credentials for a protected broker. |
| `MQTT_DISCOVERY_TOPIC` | Template value `arl/services`. Currently not used for subscriptions: the broker uses registered service subtrees and `arl/+/$topology`. |
| `PORT` | `3000`. If changed, also adjust the web development proxy target. |
| `WEB_ORIGINS` | Empty with a same-origin proxy; otherwise a comma-separated CORS allowlist. |
| `INGEST_FLUSH_MS` | `1000`: flush interval in milliseconds. |
| `INGEST_MAX_BATCH`, `INGEST_MAX_QUEUE` | `500`, `20000`: batch size and in-memory queue capacity. |
| `NODE_ENV` | Defaults to `development`; use `production` for deployment. Tests set `test`. |

### Choose a data source

Start Meridian's local database:

```sh
docker compose up -d postgres
```

Then choose **one** MQTT/ARL arrangement:

- **Local infrastructure only:** `docker compose up -d mosquitto` starts the empty local broker. Root [docker-compose.yml](docker-compose.yml) supplies PostgreSQL 16 on port 5432 and Mosquitto 2 on 1883, **not** an ARL API, researcher register, or telemetry producers. Empty dashboards and unavailable topology are expected until producers are attached.
- **Local ARL simulator:** follow the archive steps below. Keep Meridian's root PostgreSQL, but use the simulator's broker and API. Do not run both brokers on port 1883.
- **Live ARL:** use the privately provided ARL API and MQTT addresses/credentials. Local PostgreSQL can still store the captured feed; alternatively configure your own hosted database. Root Mosquitto is unnecessary. ARL supplies researcher identities, targets, and alert limits; PostgreSQL is Meridian's capture/audit store, not the authentication source.

Local Compose credentials and anonymous MQTT are development conveniences. Its published ports are not restricted to loopback; do not expose them on an untrusted network.

### Optional simulator archive

The supplied simulator distribution is external to this repository. Its extracted [README](.arl-ref/arl-sim/README.md) and [Compose file](.arl-ref/arl-sim/arl-test.yaml), when available locally, are the setup reference. **`.arl-ref/` is ignored and is not committed**; a fresh clone needs the archive separately. A partial extraction containing only the API image is insufficient for telemetry services.

Place the supplied `arl-sim.tar.gz` in `.arl-ref/` (create that directory if absent), then:

```sh
tar -xzf .arl-ref/arl-sim.tar.gz -C .arl-ref
(
  cd .arl-ref/arl-sim
  for image in images/*.tar; do docker load -i "$image"; done
  docker compose -f arl-test.yaml up -d rta lwm opg
)
```

This starts the selected services and their broker, API, and database dependencies. Omit the service names to start the entire simulator. MQTT is at `localhost:1883`, the ARL API at `http://localhost:8080`, and its documentation at `/docs`. The simulator's database is internal to its Compose project; it does not replace Meridian's separately exposed PostgreSQL database. Optional simulator settings include `ARL_SEED`, `ARL_SPEEDUP`, `ARL_START_TIME`, and `ARL_SCENARIO`; these belong to the simulator launch, not Meridian's API configuration.

### Migrate and start

Confirm the database target is local/disposable before proceeding: migrations change its schema, and **starting the API writes telemetry, alerts, and audit records** to the configured database.

```sh
npm run db:migrate
npm run dev
```

The committed migrations create [telemetry and alerts](packages/api/src/db/migrations/0000_brief_wonder_man.sql), then [the audit log](packages/api/src/db/migrations/0001_lying_clint_barton.sql), including their indexes. Startup does not apply migrations automatically. `npm run db:generate` generates migrations after schema edits; `npm run db:push` directly synchronizes a database and is not the normal fresh-install path.

Open [the console](http://localhost:5173). The API listens on port 3000; [Vite](packages/web/vite.config.ts) proxies `/api` there. For independent process control, run `npm run dev -w @sdp/api` and `npm run dev -w @sdp/web` in separate terminals. The root development script backgrounds the API and foregrounds the web server.

## Build, test, and coverage

| Command | Effect |
| --- | --- |
| `npm run build` | Type-check/build API, then type-check/build web; outputs to each package's `dist/`. |
| `npm run start -w @sdp/api` | Run the compiled API; requires a prior build and configured dependencies. There is no root `start` script. |
| `npm run preview -w @sdp/web` | Preview the built web app locally, normally on port 4173; not a production server. |
| `npm test` | Run API Jest tests, then web Jest tests. |
| `npm run test:verbose` | Run both suites with verbose test output. |
| `npm run coverage` | Run both suites with text, LCOV/HTML, JSON-summary, and Cobertura reports in each package's `coverage/`. |
| `npm run test:watch -w @sdp/api` | Watch API tests. Use `-w @sdp/web` in another terminal for web tests. |

The root `test:watch` script uses sequential `&&`, so the web watcher will not start while the API watcher remains active. To pass Jest flags explicitly, target a workspace, for example `npm run test -w @sdp/api -- --runInBand`.

Tests do not require a running PostgreSQL instance, the simulator archive, or live ARL credentials. API tests cover parsing, buffering, topology, authentication, alerts, and reconnect behavior; web tests use jsdom and Testing Library. The [broker integration test](packages/api/test/integration.broker.test.ts) uses **real MQTT over TCP on a random loopback port**, exercising subscriptions, ingestion, control publishing, and broker restart/reconnection. **Database operations, audit persistence, and ARL HTTP responses are mocked**: this is not proof of real SQL/migration correctness, production broker compatibility, or live ARL availability. Use current test/coverage output rather than fixed pass counts or coverage claims.

[GitHub CI](.github/workflows/ci.yml) and [Gitea CI](.gitea/workflows/ci.yml) run `npm ci`, `npm run build`, and `npm run coverage --verbose` on Node 20. GitHub uploads both coverage directories. Neither currently provisions a database. The separate [Gitea mirror workflow](.gitea/workflows/mirror.yml) force-pushes branches/tags to a configured private GitHub mirror; it is not part of local verification.

## Authentication and safe checks

There are no local accounts or passwords. [Researcher verification](packages/api/src/auth/researcher.ts) uses ARL's `GET /v1/researchers/:code` for profiles and authoritative `POST /v1/researchers/verify` for service permissions. Controls and alert changes require `x-researcher-code`, checked server-side. Profiles are cached for 60 seconds and verification results for 30 seconds; without a valid cached result, upstream failure denies access. Missing, unknown, defunct, and unauthorized codes are rejected. Read-only dashboards need no code.

For nonmutating application checks on an already running local API, open:

- [Liveness](http://localhost:3000/api/health): process status, not dependency readiness.
- [Database health](http://localhost:3000/api/health/db): executes `SELECT 1`.
- [Ingest/broker status](http://localhost:3000/api/stats): connection state, retries, queue/drop counts, and service activity.
- [Services](http://localhost:3000/api/services): topology availability and discovered entity counts.

These requests do not perform application writes; ordinary request logging and ongoing background ingestion can still occur. Prefer the mocked automated tests for rejection/authorization checks.

**Manual authentication check—writes possible:** [.capture/auth-check.cjs](.capture/auth-check.cjs) is not a read-only smoke test, despite its opening comment. `node .capture/auth-check.cjs` sends rejected alert/control POST requests that **can append audit rows**. Adding `--accept` also acknowledges an open LWM alert. It intends no accepted device control, but still targets mutating endpoints; never use it casually against live systems.

The script loads `packages/api/.env`, separately uses `ARL_URL` (defaults to a live ARL host) and `MERIDIAN_URL` (defaults to localhost:3000), and queries `DATABASE_URL` directly. Its database connection forces TLS with certificate verification disabled, so it is not directly compatible with the default non-TLS local PostgreSQL setup. It also needs an existing raised LWM alert and matching researcher fixtures. Review all targets and obtain explicit authorization before any run; setting only the Meridian URL does not isolate it.

## Features and operational tradeoffs

- **Live operations:** RTA dish details, weather and power dashboards, topology-advertised controls, alert acknowledgment/resolution, and an application-append-only audit view. MQTT publishes are real; the live exam simulator is described as ignoring commands, but a publish is not confirmation of device execution and must not be treated as harmless.
- **Reconnect:** exponential backoff with jitter, capped at 30 seconds, resets on success and resubscribes. `/api/stats` exposes state, attempts, disconnects, errors, and the next retry. During outages, authorized controls can be audited as accepted but return `published: false`; they are not queued for later execution.
- **Replay markers:** captured windows support play/pause, stepping, speed, scrubbing, and return-to-live. Clickable, labeled markers show alert severity, accepted/refused control audit entries, and accepted acknowledgments/resolutions. System audit rows are excluded; marker-fetch failures do not prevent telemetry replay. Controls are disabled during replay. Windows are capped at 10,000 readings, with bounded alert/audit context; shorten busy windows rather than assuming a complete export.
- **Scan image API:** `GET /api/services/rta/scans` lists up to 20 scans from the last 48 hours. `GET /api/services/rta/scans/:scanId/image` returns **JSON, not PNG**: row-major pixels, geometry, coverage, display range, lifecycle metadata, and cleaning statistics. Optional `to` is an ISO timestamp limiting samples for replay. Reconstruction uses stored scan samples, rejects missing/out-of-field/faulty data, clips median-based outliers, excludes consistently bad dishes, and averages surviving samples per pixel. Unobserved pixels remain `null`. Finished images use a bounded in-memory cache; partial images are rebuilt. Missing geometry/data can produce a 404; capture must be running to accumulate samples.
- **Persistence and security limits:** the bounded in-memory ingest queue drops oldest messages under overload; it is not a durable spool, and reconnect cannot recover missed QoS 0 telemetry. Raw storage needs an operator-managed retention policy. Researcher codes are not full account authentication; MQTT currently uses plaintext TCP, and enabled database TLS disables certificate verification. Harden transport, access, and storage before deployment beyond the lab.

For hosted web delivery, [netlify.toml](netlify.toml) builds only the web workspace and contains an API proxy placeholder that must be replaced with your deployed API address. Deploy/start the API separately and keep all backend credentials server-side.
