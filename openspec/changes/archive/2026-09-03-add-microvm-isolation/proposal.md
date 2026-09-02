## Why

The agent's isolation story stops at the tool call. Each tool call runs in a throwaway container with a read-only root, no network, no mounts and no environment (`src/sandbox/sandbox-executor.ts`), which is solid — but the process that *spawns* those containers is not isolated at all. It holds `TELEGRAM_BOT_TOKEN` in its environment, mounts the host's Docker socket, and can reach anything on the host's network. The privileged component is the bot, not the sandbox.

The goal is least privilege for the whole agent: it should see only directories that were explicitly granted, reach only hosts that were explicitly allowed, and never hold a credential in its environment.

Docker Sandboxes (`sbx`) provides exactly this, and a spike on this machine confirmed it end to end rather than on the strength of its documentation. The findings, including the ones that cost something, are recorded in design.md — Context.

## What Changes

- The agent runs inside a hardware-isolated microVM instead of directly on the host. The bot, its nested container runtime, and the per-tool-call sandboxes all live inside that boundary.
- Outbound network is default-deny. Individual hosts are allowed explicitly, per sandbox, and everything else is refused — including the host machine itself, which is unreachable from inside.
- Host directories are granted explicitly, each read-only or read-write, instead of the agent running in the user's live working tree by default.
- `TELEGRAM_BOT_TOKEN`'s value stops existing inside the boundary. It is held by a small broker process on the host, which attaches it to calls to `api.telegram.org` on the bot's behalf; inside, the variable holds a non-secret placeholder. The platform's own managed-secret mechanism cannot do this for Telegram — it substitutes into headers, and Telegram authenticates by URL path (see design.md — Context).
- The per-tool-call container sandbox is kept, unchanged, as a second layer inside the microVM.
- The LLM provider stays where it is, on the host, keeping its loopback-only binding. It becomes reachable from inside the boundary through a single explicit port grant, and remains unreachable from the local network. See design.md — Decisions.
- The agent runs from its compiled output rather than from TypeScript sources, because a host-installed `node_modules` is not usable inside (see design.md).

## Capabilities

### New Capabilities

- `agent-isolation`: the boundary the whole agent runs inside — what it can see, what it can reach, and where its credentials live. Covers default-deny egress, explicit host grants, explicit directory grants, credential injection outside the boundary, and the guarantee that the host is not reachable.

### Modified Capabilities

- `docker-deployment`: the stack no longer runs on the host's Docker daemon. It runs on the container runtime inside the isolation boundary, which changes where the LLM provider lives and what the bot's Docker socket access means.

## Impact

- New deployment tooling: `sbx` (installed with `brew install docker/tap/sbx`). This is an external dependency of the *deployment*, not of the application — no source file imports it, and the bot still runs on a plain Docker host for anyone who does not adopt it.
- `docker-compose.yml`, `DEPLOYMENT.md`, `README.md` — the isolated topology, the allowlist, and the secret binding.
- `.env.example` — `TELEGRAM_API_BASE_URL` and the broker's port, and `TELEGRAM_BOT_TOKEN` documented as a placeholder in the isolated deployment and a real value in the plain one.
- `package.json` — a script to build and launch inside the boundary.
- New `.sbxenv.yaml` (or equivalent provisioning script) declaring workspaces, allowed hosts, and secrets.
- New `scripts/telegram-broker.mjs` — the host-side token holder, plus its tests.
- One change under `src/`: `TELEGRAM_API_BASE` in `src/telegram/client.ts` becomes configuration (`TELEGRAM_API_BASE_URL`) so the bot can be pointed at the broker. Everything else in `src/` is untouched — this remains a deployment boundary, not an application change. The other application-level consequence is that the bot must be started from `dist/`.
- Supersedes the network part of the abandoned `add-sandbox-egress` approach: no hand-written egress proxy or domain allowlist is needed, because the platform enforces both.
