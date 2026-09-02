## Why

The agent's isolation story stops at the tool call. Each tool call runs in a throwaway container with a read-only root, no network, no mounts and no environment (`src/sandbox/sandbox-executor.ts`), which is solid — but the process that *spawns* those containers is not isolated at all. It holds `TELEGRAM_BOT_TOKEN` in its environment, mounts the host's Docker socket, and can reach anything on the host's network. The privileged component is the bot, not the sandbox.

The goal is least privilege for the whole agent: it should see only directories that were explicitly granted, reach only hosts that were explicitly allowed, and never hold a credential in its environment.

Docker Sandboxes (`sbx`) provides exactly this, and a spike on this machine confirmed it end to end rather than on the strength of its documentation. The findings, including the ones that cost something, are recorded in design.md — Context.

## What Changes

- The agent runs inside a hardware-isolated microVM instead of directly on the host. The bot, its nested container runtime, and the per-tool-call sandboxes all live inside that boundary.
- Outbound network is default-deny. Individual hosts are allowed explicitly, per sandbox, and everything else is refused — including the host machine itself, which is unreachable from inside.
- Host directories are granted explicitly, each read-only or read-write, instead of the agent running in the user's live working tree by default.
- `TELEGRAM_BOT_TOKEN` stops being an environment variable in a `.env` file and becomes a managed secret bound to `api.telegram.org`, so the value is attached to outbound requests to that host without ever existing inside the boundary.
- The per-tool-call container sandbox is kept, unchanged, as a second layer inside the microVM.
- **BREAKING for the LLM provider**: services on the host are unreachable from inside the boundary unless explicitly granted by port, and granting one requires exposing that service on all of the host's interfaces. Rather than open Ollama to the local network, it moves inside the boundary. See design.md — Decisions for the alternatives and what they cost.
- The agent runs from its compiled output rather than from TypeScript sources, because a host-installed `node_modules` is not usable inside (see design.md).

## Capabilities

### New Capabilities

- `agent-isolation`: the boundary the whole agent runs inside — what it can see, what it can reach, and where its credentials live. Covers default-deny egress, explicit host grants, explicit directory grants, credential injection outside the boundary, and the guarantee that the host is not reachable.

### Modified Capabilities

- `docker-deployment`: the stack no longer runs on the host's Docker daemon. It runs on the container runtime inside the isolation boundary, which changes where the LLM provider lives and what the bot's Docker socket access means.

## Impact

- New deployment tooling: `sbx` (installed with `brew install docker/tap/sbx`). This is an external dependency of the *deployment*, not of the application — no source file imports it, and the bot still runs on a plain Docker host for anyone who does not adopt it.
- `docker-compose.yml`, `DEPLOYMENT.md`, `README.md` — the isolated topology, the allowlist, and the secret binding.
- `.env.example` — `TELEGRAM_BOT_TOKEN` documented as a managed secret rather than a file value.
- `package.json` — a script to build and launch inside the boundary.
- New `.sbxenv.yaml` (or equivalent provisioning script) declaring workspaces, allowed hosts, and secrets.
- No change to `src/`. This is a deployment boundary, not an application change. The one application-level consequence is that the bot must be started from `dist/`.
- Supersedes the network part of the abandoned `add-sandbox-egress` approach: no hand-written egress proxy or domain allowlist is needed, because the platform enforces both.
