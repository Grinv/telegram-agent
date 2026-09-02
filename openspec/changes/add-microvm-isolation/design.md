## Context

See proposal.md — Why for motivation. This section records what a spike on a macOS 26.6.2 / Apple Silicon machine actually established, so the decisions below rest on measurements rather than on product documentation.

Tooling: Docker Sandboxes CLI (`sbx`) 0.39.0, installed with `brew install docker/tap/sbx`. `sbx diagnose` reported hardware virtualization available (`kern.hv_support = 1`).

Verified by running it:

- **A long-running service can be hosted.** `sbx create shell <path>` creates a boundary with no coding agent attached, and `sbx exec -d <name> <cmd>` runs a process in the background. The product is presented around coding agents, but is not limited to them.
- **The container runtime inside is private.** `docker info` inside reported server 29.7.2 with `containers=0` while the host had its own containers running — a separate daemon, not a passthrough to the host's.
- **Default-deny egress is real and is enforced by an intercepting proxy.** After `sbx policy init deny-all`, both an image pull and `curl https://api.telegram.org` returned HTTP 403 rather than a connection error.
- **Per-boundary allow rules work.** After `sbx policy allow network --sandbox <name> "api.telegram.org,wttr.in"`: `api.telegram.org` → 302, `wttr.in` → 200, `example.com` → 403.
- **The host is reachable, but only on an explicitly granted port, and only from a service bound to all interfaces.** A first attempt concluded the opposite; it was wrong on two counts, and both matter for the deployment. The allow rule must name the *host port* as `localhost:<port>` — granting `host.docker.internal` is refused — while the request from inside must address `host.docker.internal:<port>`. And the host service must bind `0.0.0.0`: a service on `127.0.0.1` is not reachable however the policy is written. Verified by running an HTTP server on the host at `0.0.0.0:11435`, adding `sbx policy allow network --sandbox <name> "localhost:11435"`, and fetching the file from inside the boundary successfully. The earlier attempt had tested against port 11434 with nothing listening on it at all, so its failures proved nothing.
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

**Ollama runs inside the boundary, despite the host now being reachable.** Reaching a host-side Ollama is possible — publish it on `0.0.0.0:11434` and grant `localhost:11434` — and it is the cheaper option: the model stays on the host, costing the boundary no memory and surviving its destruction. It is not chosen because of what it requires on the host side. Binding Ollama to `0.0.0.0` exposes it to everything that can reach the machine, not only to the boundary; the isolation gained inside is paid for by opening a service to the local network. That trade runs against the reason for doing any of this. Note that today's `docker-compose.yml` publishes no port for `ollama` at all — it is reachable only from `bot-net` — so choosing the host-side option would mean deliberately exposing something currently closed.

Running Ollama in the nested daemon keeps everything shut. The price is real: the model must be pulled inside (registry hosts in the allow list), the boundary needs memory for it (a 7B-class model is several gigabytes; the default allocation is half of host RAM, capped at 32 GiB, `--memory` overrides it), and the first start is slow.

*Two alternatives recorded, deliberately not chosen:* a host-side Ollama as described above, if the memory cost proves unacceptable and the operator accepts the exposure — possibly narrowed by binding to the boundary's interface rather than `0.0.0.0`, which was not tested. And a hosted LLM API, which would remove the memory cost entirely and demonstrate credential binding on a genuinely secret value — the API key in `sbx secret`, bound to the provider's domain, never entering the boundary — at the cost of a paid dependency and a provider change. Switching to either later costs one allow rule, one secret binding, and an `LLM_PROVIDER` change; nothing here forecloses them.

**Grant directories explicitly and narrowly.** The spike mounted the whole repository read-write, which is convenient and wrong as a default. The deployment grants what the agent needs and nothing else, with `:ro` wherever writing is not required.

**The token becomes a bound secret.** `TELEGRAM_BOT_TOKEN` moves from `.env` to `sbx secret` with a binding to `api.telegram.org`. This is the change that makes "no keys inside the boundary" literally true rather than aspirational.

## Risks / Trade-offs

**Memory pressure from an in-boundary Ollama** → The main cost of this design. Size the boundary explicitly with `--memory` rather than accepting the default, and prefer a small model. If this proves impractical, the recorded alternative above is the exit.

**Model re-pull on boundary recreation** → A destroyed boundary loses the pulled model. Boundaries persist across stop/start, so this bites on `sbx rm` / `sbx reset`, not on daily use. Accepted rather than mitigated with a shared volume, which would reintroduce host state.

**`sbx` is a new external dependency for deployment** → Confined to deployment: no source file imports it, and the existing Docker Compose path stays supported. Anyone who does not want it is unaffected.

**A wrong conclusion was drawn once already about host reachability** → The first spike concluded the host was unreachable, on evidence that turned out to be worthless (nothing was listening on the port under test, and the allow rule named the wrong resource form). The corrected behaviour — reachable only via a `localhost:<port>` grant, to a service bound on all interfaces — is what the spec now requires. The lesson generalises: a refused request is not evidence of an enforced boundary unless the same request succeeds once the boundary is opened. Task verifications in this change are written as paired checks for that reason.

**The spike's `shell` kit installed its own policy rule** → `sbx policy ls` showed a `kit`-sourced allow rule scoped to the spike boundary, separate from the rules added by hand. The provisioning step must inspect what a chosen kit grants rather than assuming the allow list contains only explicit entries.

**Two isolation layers can mask a misconfiguration** → With the microVM outside and the per-call container inside, a tool sandbox that silently lost its restrictions would still look contained. The existing sandbox tests keep asserting the inner layer's flags directly, so the inner guarantees are verified independently of the outer one.
