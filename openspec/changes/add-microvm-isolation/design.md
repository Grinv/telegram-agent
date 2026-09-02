## Context

See proposal.md — Why for motivation. This section records what a spike on a macOS 26.6.2 / Apple Silicon machine actually established, so the decisions below rest on measurements rather than on product documentation.

Tooling: Docker Sandboxes CLI (`sbx`) 0.39.0, installed with `brew install docker/tap/sbx`. `sbx diagnose` reported hardware virtualization available (`kern.hv_support = 1`).

Verified by running it:

- **A long-running service can be hosted.** `sbx create shell <path>` creates a boundary with no coding agent attached, and `sbx exec -d <name> <cmd>` runs a process in the background. The product is presented around coding agents, but is not limited to them.
- **The container runtime inside is private.** `docker info` inside reported server 29.7.2 with `containers=0` while the host had its own containers running — a separate daemon, not a passthrough to the host's.
- **Default-deny egress is real and is enforced by an intercepting proxy.** After `sbx policy init deny-all`, both an image pull and `curl https://api.telegram.org` returned HTTP 403 rather than a connection error.
- **Per-boundary allow rules work.** After `sbx policy allow network --sandbox <name> "api.telegram.org,wttr.in"`: `api.telegram.org` → 302, `wttr.in` → 200, `example.com` → 403.
- **The host is reachable on an explicitly granted port, and a loopback-only service is enough.** Two earlier attempts got this wrong; the corrected picture is what the design rests on. The allow rule must name the host port as `localhost:<port>` — granting `host.docker.internal` is refused — while the request from inside addresses `host.docker.internal:<port>`. The host service does **not** need to bind all interfaces: `127.0.0.1` works. Verified by binding an HTTP server to `127.0.0.1:11435` and confirming it was unreachable from the machine's LAN address (`192.168.0.201`) and from the VM bridge address (`192.168.64.1`), yet fetched successfully from inside the boundary.
- **Why a loopback binding suffices.** The boundary does not route to the host itself. Its egress is intercepted by a proxy running on the host, which evaluates the policy and then dials the target from the host's own network namespace — an attempt to reach a bridge-bound service surfaced the proxy's error verbatim as `dial tcp 127.0.0.1:11435: connect: connection refused`. So the policy check happens before any connection exists, and the connection that does get made originates on the host.
- **The agent runs unprivileged.** `id` inside reported `uid=1000(agent)`, in the `docker` group, not root.
- **The real bot starts and works inside.** Running the compiled bot with a deliberately invalid token produced Telegram `HTTP 404` (the request reached `api.telegram.org`) while Ollama's `/api/tags` returned `403` (blocked, as it was not allowed) — the two outcomes in the same run demonstrate the allowlist is discriminating rather than failing open or closed.

Two costs surfaced:

- **Node inside is 22.22.1**, while `package.json` declares `engines.node >= 24.0.0`. The compiled bot did run under 22, but the declared floor is not met.
- **A host-installed `node_modules` is unusable inside.** The workspace is bind-mounted, so the macOS `node_modules` appears inside a Linux guest; `tsx` failed with esbuild's "installed for another platform" error (`@esbuild/darwin-arm64` present, `@esbuild/linux-arm64` needed). Installing dependencies inside the mounted tree would overwrite the host's copy with Linux binaries and break host development.

## Goals / Non-Goals

**Goals:**
- Enforce least privilege at the platform, not in application code.
- Keep `src/` unchanged: this is a deployment boundary.
- Preserve the existing per-tool-call container sandbox as a second layer.

**Non-Goals:**
- Making the isolated deployment the only supported way to run the bot. A plain Docker host stays supported.
- Hand-written egress proxies or credential brokers. Both are superseded by platform features.
- Isolating anything below the tool sandbox that already exists.

## Decisions

**The whole agent moves inside, not just the tool sandboxes.** The bot is the privileged component — it holds the token and the Docker socket. Isolating only what is already isolated would change nothing. The nested private daemon means the existing `DockerSandboxExecutor` keeps working unmodified inside the boundary, so this costs no application code.

**Run from `dist/`, not from sources.** The `node_modules` platform mismatch has three possible answers: install dependencies inside (breaks the host's tree through the bind mount), use `--clone` so the agent works on an in-container copy (adds a git-daemon round trip and diverges from the host tree), or ship the compiled output. The third is nearly free here because the project has **no runtime dependencies at all** — `package.json` lists only `devDependencies`. `node dist/index.js` needs nothing from `node_modules`, which was confirmed by running it. It also removes `tsx` and the TypeScript toolchain from the runtime attack surface.

**Pin Node inside with a custom template rather than accepting 22.** The bot ran on 22, but `engines` declares 24 and the project targets current LTS; silently running a version below the declared floor is the kind of drift that produces a confusing failure months later. `sandboxOptions.template` / `sbx template` provides the image.

**Ollama stays on the host, bound to loopback.** The provider keeps its default `127.0.0.1:11434` binding and is reached through a single `localhost:11434` grant scoped to this boundary. Nothing is exposed: the measurements above show a loopback-bound service is unreachable from the LAN and from the VM bridge, while still reachable from inside the boundary through the policy proxy. This is strictly better than the alternatives — the model stays on the host, so the boundary needs no extra memory for it, the model is not re-pulled when the boundary is destroyed, and no registry hosts need to appear in the allow list.

An earlier revision of this design moved Ollama inside the boundary, on the belief that reaching a host service required binding it to `0.0.0.0` and thereby exposing it to the local network. That belief was wrong (see Context), and with it the reason for moving Ollama.

*Alternative recorded, deliberately not chosen:* a hosted LLM API. It would demonstrate credential binding on a genuinely secret value — the API key in `sbx secret`, bound to the provider's domain, never entering the boundary — at the cost of a paid dependency and a provider change. Switching later costs one allow rule, one secret binding, and an `LLM_PROVIDER` change.

**Grant directories explicitly and narrowly.** The spike mounted the whole repository read-write, which is convenient and wrong as a default. The deployment grants what the agent needs and nothing else, with `:ro` wherever writing is not required.

**The token becomes a bound secret.** `TELEGRAM_BOT_TOKEN` moves from `.env` to `sbx secret` with a binding to `api.telegram.org`. This is the change that makes "no keys inside the boundary" literally true rather than aspirational.

## Risks / Trade-offs

**The inference path now depends on a host-side service** → A boundary is no longer self-contained: destroying and recreating it is cheap, but the agent stops working if the host's Ollama is not running. This is the same coupling the non-isolated deployment already has, so it introduces no new operational failure mode, only a new way to misconfigure one (a missing `localhost:11434` grant looks exactly like a provider outage). The startup log already reports discovery failures against the provider, which distinguishes the two.

**A granted host port is reachable by everything inside the boundary** → The grant is per-port and per-boundary, not per-process, so any process inside can reach Ollama. The processes inside are the agent and its tool sandboxes, and the tool sandboxes run with no network at all, so in practice this is the agent alone. Worth restating rather than assuming: the boundary is the unit of trust here, not the process.

**`sbx` is a new external dependency for deployment** → Confined to deployment: no source file imports it, and the existing Docker Compose path stays supported. Anyone who does not want it is unaffected.

**A wrong conclusion was drawn once already about host reachability** → The first spike concluded the host was unreachable, on evidence that turned out to be worthless (nothing was listening on the port under test, and the allow rule named the wrong resource form). The corrected behaviour — reachable only via a `localhost:<port>` grant, to a service bound on all interfaces — is what the spec now requires. The lesson generalises: a refused request is not evidence of an enforced boundary unless the same request succeeds once the boundary is opened. Task verifications in this change are written as paired checks for that reason.

**The spike's `shell` kit installed its own policy rule** → `sbx policy ls` showed a `kit`-sourced allow rule scoped to the spike boundary, separate from the rules added by hand. The provisioning step must inspect what a chosen kit grants rather than assuming the allow list contains only explicit entries.

**Two isolation layers can mask a misconfiguration** → With the microVM outside and the per-call container inside, a tool sandbox that silently lost its restrictions would still look contained. The existing sandbox tests keep asserting the inner layer's flags directly, so the inner guarantees are verified independently of the outer one.
