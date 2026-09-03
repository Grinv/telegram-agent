## Why

Every sandbox container runs with `--network none`, and the sandbox image (`sandbox/Dockerfile`) installs only `coreutils`. Together these make an entire class of agent skill impossible: anything that calls an HTTP API from the command line — querying a weather service, hitting a REST endpoint, fetching a page — cannot run at all. The planned agent-skills work needs exactly that: a skill documenting how to drive a CLI tool against a remote API is one of the two skill kinds the agent is meant to support.

Total network isolation was the right default and stays the default. What is missing is a deliberate, documented way to relax it for deployments that want networked skills, without silently handing the sandbox access to the operator's own infrastructure.

## What Changes

- Sandbox network access becomes configurable, with two modes: fully isolated (the default, matching today's behaviour exactly) and outbound-only egress.
- In egress mode, sandbox containers are attached to a dedicated network that carries no other containers, so the agent's own services — the Ollama container, the bot container, the Docker socket — remain unreachable. The system ensures this network exists before spawning a sandbox.
- The sandbox image gains an HTTP command-line client, so a skill can actually make a request in egress mode.
- **BREAKING for operators**: the sandbox image must be rebuilt (`npm run sandbox:build`) after this change, otherwise egress mode has network access but no tool that uses it. Isolated mode is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sandbox-execution`: the "Sandbox has no host network access" requirement becomes conditional on the configured network mode, and states what stays unreachable in either mode. The "Sandbox image is pre-built and minimal" requirement is extended to cover the HTTP client. A new requirement covers provisioning the dedicated egress network.

## Impact

- `src/sandbox/sandbox-executor.ts` — the `--network` argument is chosen from configuration rather than hardcoded to `none`; the egress network is ensured to exist before the first spawn.
- `src/sandbox/docker-cli.ts` — may need a helper for the network-existence check.
- `src/config.ts` — new `SANDBOX_NETWORK` setting.
- `sandbox/Dockerfile` — adds an HTTP client package.
- `.env.example`, `README.md` — document the setting, what egress mode does and does not protect, and the rebuild requirement.
- `test/sandbox/sandbox-executor.test.ts`, `test/config.test.ts` — new cases.
- Security posture: this is a deliberate relaxation of an existing isolation guarantee. It is opt-in, off by default, and its residual risk is documented in design.md rather than left implicit.
