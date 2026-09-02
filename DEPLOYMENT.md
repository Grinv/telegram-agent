# Deployment guide

Practical runbook for running this bot: what containers exist, how to bring
them up, how to change models, and how to verify the tool-use loop actually
works. For the "why" behind the architecture, see `README.md` and
`openspec/specs/`.

Two deployment modes are covered, both fully supported: the regular [Docker
Compose deployment](#what-runs-where) below, and an [isolated
deployment](#isolated-deployment-microvm-boundary) where the bot itself —
not just its tool sandboxes — runs inside a hardware-isolated microVM.

## Getting started

Zero to a running bot, copy-paste order. Requires Docker Desktop running and
a bot token from [@BotFather](https://t.me/BotFather).

```bash
# 1. Configure
cp .env.example .env
# edit .env: set TELEGRAM_BOT_TOKEN, and set OLLAMA_MODEL to a tool-capable
# model (default in the example, qwen2.5, is fine to start with)

# 2. Build the sandbox image (one-time, and again whenever sandbox/Dockerfile changes)
npm run sandbox:build

# 3. Start bot + Ollama
npm run docker:up

# 4. Pull the model into the containerized Ollama (one-time per model)
docker compose exec ollama ollama pull qwen2.5

# 5. Check it's up
docker compose ps
npm run docker:logs
```

Now message the bot on Telegram. Watch `npm run docker:logs` for
`Message received` → (optionally) `Tool call executed` → `Inference
succeeded, sending reply`.

To stop: `npm run docker:down`. Everything below goes deeper — what each
container is for, the local-dev alternative, and how to verify the tool-use
loop without a real Telegram chat.

Want the bot itself sandboxed, not just its tool calls? That is the [isolated
deployment](#isolated-deployment-microvm-boundary): its own zero-to-running
sequence, its own prerequisites (macOS on Apple Silicon, `sbx`), and a token
that never enters the boundary. Start here first if you just want a working
bot — the two modes share the same token, so only one can poll Telegram at a
time.

## What runs where

Two containers, one Docker network (`bot-net`), defined in `docker-compose.yml`:

| Container | Image | Purpose | Reachable at |
| --- | --- | --- | --- |
| `bot` | built from `Dockerfile` | Polls Telegram, runs the think→act→observe loop | n/a (outbound only: Telegram API, `ollama`, Docker socket) |
| `ollama` | `ollama/ollama:latest` | Serves the LLM | `http://ollama:11434` (inside `bot-net` only — no host port published) |

A **third**, ephemeral kind of container is spawned by `bot` on demand, one
per tool-use step:

| Container | Image | Purpose |
| --- | --- | --- |
| sandbox (short-lived) | `telegram-agent-sandbox`, built from `sandbox/Dockerfile` | Executes one batch of tool calls (`execute_command`, `read_file`, `write_file`, `list_files`), then is torn down. Read-only rootfs, `--network none`, CPU/memory/time capped. |

`bot` mounts the host's `/var/run/docker.sock`, so it talks to the **same
Docker daemon you're running commands against on the host** — sandbox
containers show up in `docker ps` right next to `bot` and `ollama`, they are
not nested inside `bot`.

```
┌─────────────────────────── host Docker daemon ───────────────────────────┐
│                                                                            │
│   ┌────────────┐   bot-net    ┌──────────────┐                           │
│   │    bot     │◄────────────►│    ollama    │                           │
│   │ (polls TG) │  http://     │ (LLM server) │                           │
│   └─────┬──────┘  ollama:11434└──────────────┘                           │
│         │ spawns via /var/run/docker.sock (not bot-net)                  │
│         ▼                                                                │
│   ┌────────────────┐  one per tool-use step, torn down after             │
│   │ sandbox (short) │  --read-only --network none --memory --cpus        │
│   └────────────────┘                                                     │
└────────────────────────────────────────────────────────────────────────┘
```

## Isolated deployment (microVM boundary)

This is a second, optional way to run the bot, alongside the Docker Compose
deployment above — not a replacement for it. Pick whichever fits; both are
fully supported.

### What this is, and when to use it

In the deployment above, `bot` is trusted: it holds the real Telegram token
and the host's Docker socket, and is not itself sandboxed — only the
per-tool-call containers it spawns are. The isolated deployment moves the
trust boundary out one level further: the bot, its own (nested, private)
Docker daemon, and every per-tool-call sandbox it spawns all run inside a
hardware-isolated microVM ("the boundary"), managed by [Docker
Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`). Use it when you
don't want the bot process itself — not just the tool sandbox — to have
unmediated access to your machine: the boundary sees exactly three host
directories and two host ports, nothing else, and the real Telegram token
never enters it at all.

The per-tool-call sandbox (`telegram-agent-sandbox`, read-only rootfs,
`--network none`) still exists inside the boundary, unchanged — this adds a
layer around the whole agent, it doesn't replace the existing one.

### Requirements and one-time machine setup

- macOS on Apple Silicon, with hardware virtualization available
  (`kern.hv_support = 1`).
- [`sbx`](https://docs.docker.com/ai/sandboxes/), the Docker Sandboxes CLI
  (verified against 0.39.0):
  ```bash
  brew install docker/tap/sbx
  sbx diagnose        # confirms hardware virtualization is available
  ```
- A machine-wide deny-all network policy, set once per machine (not per
  boundary):
  ```bash
  sbx policy init deny-all
  ```
  Verify it took effect:
  ```bash
  sbx policy check network example.com
  # Denied ... default deny
  ```
  `sbx policy reset` undoes this if you ever need to start the policy over.
- A custom sandbox template with Node 24. The stock
  `docker/sandbox-templates:shell-docker` image ships Node 22, below this
  project's declared `engines.node >= 24`. Build it on the **host** and load
  it in — building it inside a live boundary would mean adding
  `nodejs.org` to that boundary's allow list, which the deny-all default is
  specifically there to avoid:
  ```bash
  docker build -t telegram-agent-boundary:node24 isolation
  docker save telegram-agent-boundary:node24 -o /tmp/boundary.tar
  sbx template load /tmp/boundary.tar
  ```
- A **host-installed** Ollama, reachable at `127.0.0.1:11434` with your
  model pulled (`ollama serve`, `ollama pull qwen2.5` or whatever
  `OLLAMA_MODEL` is set to — same as the [local (non-Docker)
  alternative](#local-non-docker-alternative) above). The isolated
  deployment reaches Ollama through a `localhost:11434` grant into the host's
  network namespace, so the Compose `ollama` container doesn't work here —
  it publishes no host port.

  This is a real trap in practice: the host's Ollama and the Compose one are
  **separate model stores**, and it is easy to have a tool-capable model in the
  container and only leftovers on the host. The bot sends its tool definitions
  on every inference call, and Ollama answers `HTTP 400` for a model that does
  not declare tool support, so a host store holding, say, `tinyllama` or
  `codellama` produces failures that look like provider outages:

  ```
  [INFO]  Routing decision { model: 'tinyllama:latest', source: 'classifier' }
  [ERROR] LLM provider error { reason: 'PROVIDER_ERROR', detail: 'Ollama responded with HTTP 400' }
  ```

  Model routing picks among *everything* the store reports, so one unsuitable
  model there is enough to break some messages while others succeed. Pull the
  same tool-capable models onto the host that the Compose deployment uses, and
  remove or avoid the ones without tool support:

  ```bash
  ollama list                    # what the host store actually holds
  ollama pull qwen3:1.7b         # or whatever OLLAMA_MODEL / CLASSIFIER_MODEL name
  ```

### Bringing it up, step by step

```bash
# 0. If the regular Compose deployment is running, stop it first — both
#    poll Telegram with the same token, and only one getUpdates poller can
#    be active at a time (see Troubleshooting).
npm run docker:down   # or: docker stop telegram-agent-bot-1

# 1. Configure — same .env as the Compose deployment. TELEGRAM_BOT_TOKEN
#    is the real token here too: it's read by the host-side broker, not by
#    the bot inside the boundary (see "The token" below).
cp .env.example .env   # if you haven't already; then fill in TELEGRAM_BOT_TOKEN

# 2. Build the bot, export the sandbox image, create the boundary (if it
#    doesn't already exist), apply the network policy, and load the
#    sandbox image inside. Safe to re-run — it's idempotent.
npm run isolated:provision

# 3. Start the broker in its own terminal, from the repo root (it reads
#    .env for the token). Leave it running.
npm run isolated:broker
# telegram-broker: listening on 127.0.0.1:8081

# 4. Start the bot inside the boundary.
npm run isolated:start
# ==> Starting the bot inside "tg-agent" (log: data/bot.log)
# Started. Follow it with: tail -f data/bot.log

# 5. Check it's up
npm run isolated:status
tail -f data/bot.log
```

Message the bot on Telegram and watch `data/bot.log` for the same
`Message received` → `Inference succeeded, sending reply` lines as the
Compose deployment.

### What the boundary can see

Exactly three host directories and two host ports — nothing else. The repo
root is not mounted, so `.env` (and the real token in it) is not reachable
from inside; `cat .env` inside returns "No such file".

| Grant | Host path | Mode | Why |
| --- | --- | --- | --- |
| Directory | `./data` | read-write | Bot log, stats DB, sandbox-image staging. Must be the first workspace and read-write — an `sbx` requirement. |
| Directory | `./dist` | read-only | The compiled bot (`node dist/index.js` is what actually runs inside — see below). |
| Directory | `./.sbx` | read-only | Staging area for the sandbox-image tarball (`.sbx/sandbox-image.tar`). |
| Port | `localhost:11434` | inbound to boundary only | Host Ollama. Addressed from inside as `host.docker.internal:11434`. |
| Port | `localhost:8081` | inbound to boundary only | Telegram broker (below). Addressed from inside as `host.docker.internal:8081`. |

Host paths are mirrored inside the boundary (e.g. `./data` on the host is
`./data`, at the same relative path, inside).

**Runs from `dist/`, not from source.** The host's `node_modules` is
useless inside — it's a bind mount, so macOS-built native binaries (e.g.
esbuild) show up in a Linux guest and fail to load. The project has no
runtime dependencies at all, so `node dist/index.js` needs nothing from
`node_modules`. `npm run build` writes a minimal `dist/package.json`
(`{"type":"module"}`) so Node treats `dist/*.js` as ESM — the real
`package.json`, which would normally supply that, isn't mounted in.

The sandbox image (`telegram-agent-sandbox`) is carried into the boundary
as a tarball (`docker save` → `.sbx/sandbox-image.tar` → `docker load`
inside) rather than pulled from a registry, so no registry host has to be
added to the allow list either.

Inside, the bot runs as an unprivileged user (`id` → `uid=1000(agent)`, not
root).

### The token: why a broker, what it protects

The Telegram Bot API puts the token in the URL path
(`/bot<TOKEN>/getUpdates`), not in a header. `sbx`'s per-boundary network
policy can only allow or deny hosts, and offers no way to inject a secret
into a URL — so the token cannot simply "be" a grant.

Instead, `scripts/telegram-broker.mjs` runs on the **host**, outside the
boundary, bound only to `127.0.0.1:8081`. It reads the real token from
`.env`, and for each request splices it into the path of a request it
forwards to `api.telegram.org`, allowing exactly two Bot API methods:
`getUpdates` and `sendMessage`. Inside the boundary,
`TELEGRAM_BOT_TOKEN=placeholder-held-by-host-broker` — a deliberate
non-secret — and `TELEGRAM_API_BASE_URL` points at the broker
(`http://host.docker.internal:8081`). `api.telegram.org` itself is not in
the boundary's allow list; a direct request to it from inside returns 403.

**What this protects:** the token value itself never exists inside the
boundary and cannot be exfiltrated from it, even if a tool call somehow
escaped the per-call sandbox.

**What this doesn't protect:** anything on the host that can reach
`127.0.0.1:8081` can drive the bot's Telegram account (send messages, read
updates) without ever learning the token. That's a wider exposure than a
`.env` file guarded by filesystem permissions — mitigated only by the
two-method allowlist and by the broker being stoppable independently of the
boundary. It's the same shape of risk already accepted for the host's
Ollama binding, not a new category of one.

### Stopping, rebuilding, destroying

```bash
npm run isolated:stop      # kills the bot process inside; the boundary itself keeps running
npm run isolated:status    # sbx ls + policy ls + processes inside + tail of data/bot.log
```

After changing code in `src/`:

```bash
npm run build              # dist/ is a live read-only mount, so the boundary sees it immediately
npm run isolated:stop
npm run isolated:start
```

Re-run `npm run isolated:provision` instead if `isolation/Dockerfile` or
`sandbox/Dockerfile` changed — it rebuilds the sandbox image, re-exports it,
and reloads it into the boundary; it also re-applies the network policy,
which matters (see Troubleshooting: kit rule reappears).

```bash
npm run isolated:destroy   # sbx rm -f tg-agent
```

Leaves no containers or images behind on the host (verified by diffing
`docker ps -a` / `docker images` before and after). The granted directories
— `data/`, `dist/`, `.sbx/` — are untouched; only the boundary and its
nested runtime state go away.

**Going back to the Compose deployment:** stop the broker (Ctrl-C) and the
boundary's bot (`npm run isolated:stop`, or `npm run isolated:destroy` if
you're done with it), then `npm run docker:up` as usual. The host-installed
Ollama used here and the Compose `ollama` container have separate model
stores, same as the [local (non-Docker)
alternative](#local-non-docker-alternative) — no model data carries over
either direction.

### Why not something else

Two placements for the LLM provider were considered and rejected — worth
knowing if you're tuning boundary memory limits and looking for a lever:

- **Ollama inside the boundary.** Would avoid depending on a host service,
  but costs boundary memory for the model, re-pulling the model every time
  the boundary is destroyed and recreated, and adding a registry host to
  the allow list. An earlier design revision chose this, on the mistaken
  belief that reaching a host service required binding it to `0.0.0.0`
  (exposing it to the LAN). Measurement showed a loopback-only binding is
  reachable from inside the boundary through the policy proxy and
  unreachable from the LAN or the VM bridge — so there was no exposure to
  trade away, and Ollama moved back to the host.
- **A hosted LLM API instead of Ollama.** Rejected as the default because
  it adds a paid dependency and a provider change, but it's the more
  natural escape hatch if you actually want to demonstrate credential
  binding on a genuine secret (an API key bound via `sbx secret`, never
  entering the boundary) rather than routing around one, as the Telegram
  broker has to. Switching later costs one allow rule, one `sbx secret`
  binding, and an `LLM_PROVIDER` change.

**Why the Telegram token isn't an `sbx secret`.** `sbx secret set` covers a
fixed list of services (Anthropic, GitHub, OpenAI, OpenRouter, and a few
others) — Telegram isn't in it. The experimental `sbx secret set-custom`
substitutes a bound secret only into request **headers**; Telegram
authenticates via the URL path. Measured: with a custom secret bound to
`api.telegram.org` and the generated placeholder token, a request from
inside to `.../bot$TELEGRAM_BOT_TOKEN/getMe` reached Telegram and got
Telegram's own `404 {"ok":false,"description":"Not Found"}` back — the
placeholder was silently never substituted. Don't "simplify" the broker
back into a managed secret; it will look like it works and won't
authenticate.

### Troubleshooting (isolated deployment)

**Bot logs show `HTTP 409` on `getUpdates`.**
Two active pollers on the same token — the Compose `bot` container and the
boundary's bot are both running. Telegram allows only one `getUpdates`
poller per token. Stop one: `npm run docker:down` (or `docker stop
telegram-agent-bot-1`) before starting the isolated deployment, or `npm run
isolated:stop` before starting Compose.

**Inference fails / log shows a failed model-discovery call at startup.**
Almost always means the boundary can't reach the host Ollama — either the
`localhost:11434` grant is missing (`npm run isolated:status` → look under
"policy rules in force"; re-run `npm run isolated:provision` if it's not
there) or Ollama isn't actually running on the host
(`curl 127.0.0.1:11434` from the host itself should return something).

**`npm run isolated:start` refuses to start, pointing at the broker.**
The broker isn't answering on `127.0.0.1:8081`. Start it (`npm run
isolated:broker`, in its own terminal, from the repo root — it needs `.env`
for the token) before starting the bot.

**`openrouter.ai` becomes reachable again after recreating the boundary.**
The `shell` kit installs its own allow rule for `openrouter.ai` at
`sbx create` time, and it isn't editable directly — the provisioning script
narrows it with a local deny rule instead. That local deny doesn't survive
a boundary recreation, so re-apply it: `npm run isolated:provision` (safe
to re-run; it always re-applies the policy). Verify with:
```bash
sbx policy check network --sandbox tg-agent openrouter.ai
# Denied ...
```

## One-time setup

```bash
cp .env.example .env          # then fill in TELEGRAM_BOT_TOKEN
npm run sandbox:build         # builds telegram-agent-sandbox (needed before docker:up will start)
```

`sandbox:build` passes `--pull`, so it refreshes its Alpine base rather than
reusing whatever copy happens to sit in the local image store. That matters
more here than in a normal build: this image is the container untrusted
tool calls execute in, and a stale base means it quietly runs an Alpine
that stopped receiving security updates. Re-run the command periodically,
not only when `sandbox/Dockerfile` changes — the Dockerfile can be
unchanged for a year while its base moves several releases. Check what you
actually have with:

```bash
docker run --rm --entrypoint cat telegram-agent-sandbox:latest /etc/alpine-release
```

In `.env`, set `OLLAMA_MODEL` to a **tool-calling-capable** model — this is
the single most common way to get stuck. `llama3` (an old default some
setups still reference) does **not** support tool calling; the model just
answers in prose and never triggers `execute_command`. Known-good small
models: `qwen2.5`, `qwen3.5:0.8b`, `llama3.1`, `mistral-nemo`. Check any
model's capabilities before relying on it:

```bash
docker compose exec ollama ollama show <model> | grep -A3 Capabilities
# must list "tools" in the output
```

## Bringing the stack up

```bash
npm run docker:up      # = check sandbox image exists, then `docker compose up -d --build`
```

`docker:up` refuses to start (with a clear message) if you skipped
`npm run sandbox:build` — the check lives in `scripts/check-sandbox-image.mjs`.

First time only — pull the model into the **containerized** Ollama (its data
volume is empty on a fresh `docker compose up`, separate from any model you
may have pulled via a host-installed `ollama`):

```bash
docker compose exec ollama ollama pull qwen3.5:0.8b   # or whatever OLLAMA_MODEL is set to
```

Check everything is up:

```bash
docker compose ps
# NAME                      STATUS
# telegram-agent-bot-1      Up
# telegram-agent-ollama-1   Up
```

## Stopping / rebuilding

```bash
npm run docker:down    # docker compose down — stops and removes bot + ollama
npm run docker:logs    # docker compose logs -f — tails both containers
```

After changing code in `src/`, `npm run docker:up` again — it always passes
`--build`, so it recompiles the image from your current source. There's no
separate "rebuild" command.

Ollama's pulled models live in a **named volume** (`ollama-data`), so
`docker:down` → `docker:up` does *not* require re-pulling the model. Only
`docker compose down -v` (not what `docker:down` runs) would wipe it.

## Local (non-Docker) alternative

For fast iteration on `src/` without rebuilding an image each time:

```bash
# .env: OLLAMA_BASE_URL=http://127.0.0.1:11434 (not the ollama:11434 Docker default)
ollama serve &                # host-installed Ollama
ollama pull qwen3.5:0.8b
npm run dev                   # tsx, runs src/index.ts directly
```

The bot still shells out to `docker` for sandboxes (`DockerSandboxExecutor`
talks to the Docker CLI either way), so **Docker Desktop must be running**
even in this mode, and `npm run sandbox:build` still applies.

## Verifying it actually works

Sending the bot a real Telegram message is the normal check — message it,
then watch:

```bash
docker compose logs -f bot
```

You should see, per message:

```
[INFO] Message received { chatId, prompt }
[INFO] Tool call executed { iteration, toolCalls: [...], results: [...] }   # only if a tool was used
[INFO] Inference succeeded, sending reply { chatId, reply, iterations }
```

If you don't have a Telegram chat handy, drive the same code path directly
without touching Telegram — useful for confirming the model/sandbox
combination actually does tool calling before wiring up the real bot. Save
as e.g. `scratch/verify.mjs` (build first: `npm run build`):

```js
import { createMessageHandler } from '../dist/orchestrator.js';
import { createDefaultToolRegistry } from '../dist/tools/index.js';
import { DockerSandboxExecutor } from '../dist/sandbox/sandbox-executor.js';

const handleMessage = createMessageHandler({
  client: { sendMessage: async (chatId, text) => console.log('REPLY:', text) },
  provider: 'ollama',
  timeoutMs: 60000,
  sandboxExecutor: new DockerSandboxExecutor({
    image: 'telegram-agent-sandbox', timeoutMs: 30000, memoryLimit: '256m', cpuLimit: '0.5',
  }),
  toolRegistry: createDefaultToolRegistry(),
  maxIterations: 5,
});

await handleMessage({
  message_id: 1,
  chat: { id: 1 },
  text: 'Run the shell command `echo hi && whoami && pwd` using your tool and report the output verbatim.',
});
```

Run it inside a container on `bot-net` so `OLLAMA_BASE_URL=http://ollama:11434`
(the compose default) resolves, with the Docker socket mounted so sandbox
spawning works:

```bash
docker run --rm \
  --network telegram-agent_bot-net \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/dist:/app/dist:ro" \
  -v "$PWD/scratch/verify.mjs:/app/verify.mjs:ro" \
  -w /app -e OLLAMA_MODEL=qwen3.5:0.8b \
  telegram-agent-bot node verify.mjs
```

A successful run logs a `Tool call executed` line with `ok: true` and the
final reply reflects the sandbox's actual output (e.g. contains `hi` and the
sandbox's own `whoami`, not the host's). If the reply never mentions the
command output, the model likely isn't calling the tool at all — see
Troubleshooting.

## Troubleshooting

**Bot replies with prose instead of running the command.**
The model isn't calling `execute_command` — almost always means
`OLLAMA_MODEL` doesn't support tool calling. Verify with
`docker compose exec ollama ollama show <model>` (must list `tools` under
Capabilities). Small/old models often report `tools` but are unreliable at
following the argument schema in practice — if replies look confused, try a
slightly larger model (e.g. `qwen3.5:0.8b` instead of `qwen2.5:0.5b`).

**Everything is very slow (tens of seconds per reply).**
Ollama in Docker Desktop on macOS runs the model on CPU only — there's no
GPU passthrough into the Linux VM. This is expected, not a bug. Budget
`LLM_TIMEOUT_MS` generously (60000+) for anything beyond the smallest
models, especially "thinking"/reasoning models that generate a hidden
reasoning trace before answering.

**`npm run docker:up` fails immediately with a sandbox image error.**
Run `npm run sandbox:build` first — `docker:up` checks for the image before
starting and refuses to proceed without it (this is intentional, not a bug).

**Bot can't reach Ollama / connection refused.**
Check `OLLAMA_BASE_URL` in `.env`. In Docker it must be
`http://ollama:11434` (the compose service name); `http://127.0.0.1:11434`
only works when both processes are on the host (the local-dev path above).

**A tool call fails with "No tool registered with name ...".**
The model hallucinated a tool name. This is fed back to the LLM as a normal
tool-failure observation (not a crash) — the loop will retry or the model
will explain it couldn't find the tool. If you see the bot instead send a
generic "could not process your message" reply for this case, that's the
bug fixed in `fix-unknown-tool-call-handling`; make sure you're running a
build that includes it.

**Want to poke around inside a running container.**
```bash
docker compose exec bot sh        # shell inside the bot container
docker compose exec ollama sh     # shell inside the ollama container
docker ps                         # see sandbox containers while one is briefly alive
```
</content>
