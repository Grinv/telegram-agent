## Context

`src/sandbox/sandbox-executor.ts` spawns every sandbox with a fixed argument list that includes `--network none`, and `sandbox/Dockerfile` is `FROM alpine:latest` with `apk add --no-cache coreutils`. So there is neither a route out nor a client to use one. See proposal.md — Why.

The deployment topology matters for what "opening the network" costs: `docker-compose.yml` puts the bot and the LLM provider on a shared network (`bot-net`), and the bot container mounts the host Docker socket. The sandbox mounts no socket. Any egress design has to avoid handing the sandbox a path to those.

## Goals / Non-Goals

**Goals:**
- Make outbound HTTP possible from inside a sandbox, opt-in.
- Keep the default posture byte-for-byte what it is today.
- Keep the agent's own containers unreachable from a networked sandbox.
- State the residual risk plainly rather than implying the egress mode is as safe as isolation.

**Non-Goals:**
- A domain allowlist. See Decisions.
- Inbound connectivity to the sandbox. Nothing needs to reach into it.
- Per-tool or per-skill network policy. The mode is deployment-wide.

## Decisions

**Two coarse modes (`isolated`, `egress`) rather than a filtering proxy.** The thorough design is an egress proxy container with a domain allowlist: sandboxes join an `--internal` network with no route out, and only the proxy can reach the internet. It is genuinely more secure. It also adds a long-lived container, a proxy config, TLS interception or CONNECT-allowlisting, and a failure mode for every request. That is a large amount of machinery for a bot whose networked use case today is "fetch a weather page". The two-mode design is the smallest thing that unblocks the skill work while keeping the default safe, and it does not foreclose the proxy — a third mode can be added later without changing the first two.

**A dedicated network, not Docker's default bridge.** `--network bridge` would work but puts the sandbox on a network shared with every container on the host that did not pick a network, which in a developer's environment is unpredictable. A named network used only by sandboxes makes the blast radius explicit and keeps `bot-net` — and therefore the LLM provider and the bot — out of reach. Sandbox containers are still spawned one per act step and removed afterwards; only the network persists.

**Provisioning is lazy and idempotent.** The network is ensured to exist before a sandbox is spawned in egress mode, by checking for it and creating it if absent. Creation must tolerate losing a race (two spawns starting at once): an "already exists" failure is treated as success, not an error. Creating it eagerly at startup was the alternative; lazy keeps isolated-mode deployments from creating a network they never use.

**`curl` plus `ca-certificates`, explicitly.** Alpine's BusyBox ships a `wget`, but its TLS support is a build-time detail not worth depending on, and the skills being written name `curl`. `ca-certificates` is required too — without a trust store, HTTPS fails with a certificate error that reads like a network problem and will cost someone an afternoon.

**Mode names describe intent, not mechanism.** `isolated` / `egress` rather than `none` / `bridge`, so the setting still reads correctly if the mechanism behind egress is later replaced by a proxy.

**A host-side HTTP tool was considered and rejected.** Giving the agent an `http_request` tool that runs in the bot process, with an allowlist enforced in TypeScript, needs no Docker networking at all and is easy to test. It loses because it moves network access *out* of the sandbox and into the privileged process that holds the Telegram token and the Docker socket — the opposite of the isolation the sandbox exists for. It also cannot support the general case the skills need, which is an arbitrary command-line program that happens to use the network.

## Risks / Trade-offs

**In egress mode the sandbox can reach the host through the Docker gateway address** → Not mitigated. A container on a bridge network can address the host, so a sandboxed command could reach services bound on the host — including a locally-run Ollama on `11434` in the non-Docker development setup. This is the main reason the mode is opt-in and off by default. Blocking it requires firewall rules on the bridge, which is where the proxy design starts to pay for itself; documented here so the choice to enable egress is made with open eyes.

**In egress mode the sandbox can exfiltrate whatever it can read** → Accepted, and bounded by the sandbox's own filesystem: the root filesystem is read-only and the writable workdir starts empty each act step, so there is little to exfiltrate beyond what the tool call itself produced.

**The image grows** → `curl` and `ca-certificates` add a few megabytes to an Alpine base. The "minimal image" requirement is about attack surface and startup time, and neither meaningfully moves.

**Operators who skip the image rebuild get a confusing failure** → Egress mode with a stale image yields "curl: not found", which reads as a broken skill rather than a missing rebuild. Mitigated by documenting the rebuild in the same place the setting is documented, and by keeping the failure text from the tool visible to the model.
