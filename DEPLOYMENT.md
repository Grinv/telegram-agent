# Deployment guide

Practical runbook for running this bot: what containers exist, how to bring
them up, how to change models, and how to verify the tool-use loop actually
works. For the "why" behind the architecture, see `README.md` and
`openspec/specs/`.

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

## One-time setup

```bash
cp .env.example .env          # then fill in TELEGRAM_BOT_TOKEN
npm run sandbox:build         # builds telegram-agent-sandbox (needed before docker:up will start)
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
