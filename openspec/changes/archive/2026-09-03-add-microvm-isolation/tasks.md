Verification note: several scenarios here assert that something is *blocked*. A blocked request proves nothing on its own — it can fail for unrelated reasons, which is how the first spike reached a wrong conclusion (see design.md — Risks). Every "is denied" task below is therefore paired with an "and succeeds once granted" step against the same target. Do not mark such a task done on the negative half alone.

## 1. Provisioning the boundary

- [x] 1.1 Install the sandbox tooling (`brew install docker/tap/sbx`) and confirm the machine supports it. Verify: `sbx diagnose` reports virtualization supported.
- [x] 1.2 Initialize the global network policy to deny-all (`sbx policy init deny-all`). Note that this is one-time and machine-global; `sbx policy reset` starts over. Verify: `sbx policy ls` shows a deny-all policy applying to all sandboxes.
- [x] 1.3 Build a sandbox template image providing Node 24 or newer, so the boundary meets the project's declared `engines.node`. Verify: `node --version` inside a boundary created from the template reports 24.x or newer.
- [x] 1.4 Create the boundary from that template, granting only the directories the agent needs, each with an explicit access mode, and record the exact command in `DEPLOYMENT.md`. Verify: the boundary is listed by `sbx ls` and the granted directories are present inside it.

## 2. Credentials

The platform's managed secrets substitute into request headers only, and Telegram authenticates by URL path, so the token is held by a broker on the host instead (design.md — Decisions). The guarantee is unchanged: the value never exists inside the boundary.

- [x] 2.1 Make the Telegram API base URL configuration rather than a constant (`TELEGRAM_API_BASE_URL`, resolved in `src/config.ts`, consumed by `src/telegram/client.ts`), defaulting to `https://api.telegram.org` so the plain deployment is untouched. Verify: tests cover the default and an override, and `npm test` passes.
- [x] 2.2 Add the host-side broker (`scripts/telegram-broker.mjs`): holds the real token, binds to `127.0.0.1` only, rewrites `/bot<placeholder>/<method>` to the real token, and allows only `getUpdates` and `sendMessage`. Verify: its tests cover the rewrite and the refusal of a method outside the allowlist.
- [x] 2.3 Wire the isolated deployment to it: `TELEGRAM_BOT_TOKEN` inside holds a non-secret placeholder, `TELEGRAM_API_BASE_URL` points at the broker via `host.docker.internal`, and the broker's port is granted as `localhost:<port>`. Verify: `sbx policy ls` for the boundary shows the broker's port granted and `api.telegram.org` absent.
- [x] 2.4 Verify the real token is genuinely absent inside the boundary: search the environment, the granted directories, and any generated config for its value (covers "Credential is not readable from inside"). Verify: the value appears nowhere inside.
- [x] 2.5 Verify the bot authenticates anyway, by starting it and confirming `getUpdates` succeeds rather than returning 401/404 (covers "Agent authenticates without holding the credential"). Verify: the polling loop runs without authentication errors.
- [x] 2.6 Paired check for "Credential holder refuses operations the agent does not use" and "The boundary has no direct route to Telegram": from inside, call a method outside the allowlist through the broker, and request `api.telegram.org` directly. Verify: the first is refused by the broker and the second by the network policy, while `getUpdates` through the broker still succeeds.

## 3. LLM provider on the host

- [x] 3.1 Keep the LLM provider on the host with its loopback-only binding (Ollama's default `127.0.0.1:11434`); do not publish it on other interfaces. Verify: `lsof -nP -iTCP:11434 -sTCP:LISTEN` on the host shows it bound to `127.0.0.1`, not `*`.
- [x] 3.2 Grant the provider's port to the boundary as `localhost:11434`, and point the bot at `http://host.docker.internal:11434` via `OLLAMA_BASE_URL`. Verify: the bot's startup model discovery lists the pulled models instead of logging a non-OK status.
- [x] 3.3 Paired check for "Provider is unreachable without the grant" / "Provider is reachable from the isolated bot": remove the grant and confirm inference fails, then restore it and confirm inference succeeds. Verify: the same request fails, then succeeds.
- [x] 3.4 Check "Provider is not reachable from the local network": from another machine on the LAN, request this host's port 11434. Verify: the request fails while the isolated bot's inference still works.
  - Verified from a second device (a phone on the same Wi-Fi), with a control to make the negative result mean something: a service bound to 0.0.0.0:8097 on the host was reachable from the phone, proving it reaches this host at all, while http://192.168.0.201:11434 failed to connect with Ollama running and answering 200 on loopback. Also refused from the host's own LAN address and from the VM-bridge address (192.168.64.1), while the isolated bot's inference kept working through the localhost:11434 grant.
  - Note on method: the first attempt at this check was worthless and was redone — the host's Ollama had been stopped beforehand, so nothing was listening and the refusal proved nothing. Same failure mode design.md records for the original spike.

## 4. Running the agent

- [x] 4.1 Establish the build-and-launch path: build on the host with Node 24 (`npm run build`) and start the compiled output inside the boundary (`node dist/index.js`), which needs no `node_modules` because the project declares no runtime dependencies. Add a script for it to `package.json`. Verify: the bot starts inside the boundary and logs `Bot starting`.
- [x] 4.2 Confirm the agent runs unprivileged inside the boundary (covers "Agent runs unprivileged"). Verify: `id` inside reports a non-root user.
- [x] 4.3 Confirm the per-tool-call sandbox still works inside the boundary by sending a message that triggers `execute_command`, and confirm no container appears on the host's runtime while it runs (covers "Tool sandboxes run inside the boundary" and "Tool sandboxes use the boundary's runtime"). Verify: the tool result is correct and `docker ps` on the host shows no sandbox container.
  - Verified end to end from Telegram: a message asking for `uname -a` produced `Tool call executed { toolCalls: [ 'execute_command' ], results: [ { name: 'execute_command', ok: true } ] }` and a reply carrying the sandbox's real output — `Linux 10173e56b1f5 7.0.12 #1 SMP PREEMPT aarch64 GNU/Linux`. That output is self-certifying: the hostname is the sandbox container's id and the kernel is the microVM's, not the macOS host's. No sandbox container appeared on the host at any point.
  - Getting there needed a separate fix: tool calling was broken for every deployment, because the Ollama connector forwarded tool definitions in a flat shape the provider cannot read, so tool calls came back with an empty name. Tracked and fixed in the `fix-ollama-message-mapping` change; it also needed a model able to emit tool calls at all (`qwen3:4b` works, `qwen3:1.7b` and smaller do not).
  - Root cause of the missing tool call, worth knowing: the host's Ollama store and the Compose one hold different models. The host's held `tinyllama` and `codellama:7b`, which do not support tool calling, so routing to them produced `HTTP 400` before any generation. Recorded in DEPLOYMENT.md.

## 5. Network boundary verification

- [x] 5.1 Paired check for "Unallowed host is refused" / "Allowed host is reachable": from inside the boundary, request a host absent from the allow list and confirm it fails; add it, confirm the same request succeeds; remove it again. Verify: the same request fails, then succeeds, then fails.
- [x] 5.2 Paired check for "Host service is refused without a grant" / "Host service is reachable after a grant": run a service on the host bound to all interfaces, confirm it is refused from inside, then grant it as `localhost:<port>`, request it as `host.docker.internal:<port>`, and confirm it succeeds. Verify: the same request fails, then succeeds.
- [x] 5.3 Check "A grant does not open other host ports": with one host port granted, run a second service on a different host port and confirm it is refused from inside. Verify: the ungranted port fails while the granted one still succeeds.
- [x] 5.4 Check "Allow rules do not leak between boundaries": create a second boundary, and confirm a host allowed only for the first is refused from the second. Verify: the request fails in the second boundary.
- [x] 5.5 Enumerate every rule actually in force for the boundary, including any contributed by the kit rather than added by hand (see design.md — Risks), and confirm each one is intended. Verify: `sbx policy ls` and `sbx policy inspect` show no rule the deployment did not ask for.

## 6. Filesystem boundary verification

- [x] 6.1 Check "Granted directory is available": write a file from inside a read-write grant and confirm it appears on the host. Verify: the file exists on the host with the expected contents.
- [x] 6.2 Check "Read-only grant cannot be written": attempt a write inside a read-only grant. Verify: the write fails and the host directory is unchanged.
- [x] 6.3 Check "Ungranted directory is invisible": attempt to read a host directory that was not granted, such as the user's home directory. Verify: the read fails.
- [x] 6.4 Check "Destroying the boundary leaves no residue": destroy the boundary and confirm no containers, images, or writable state from it remain on the host outside the granted read-write directories. Verify: the host's `docker ps -a` and `docker images` show nothing created by the agent.

## 7. Documentation

- [x] 7.1 Document the isolated deployment in `DEPLOYMENT.md`: provisioning, the exact grants and allow rules, the secret binding, how to start and stop it, and how to fall back to the plain Docker deployment. Verify: the runbook can be followed start to finish on a clean machine.
- [x] 7.2 Update `README.md` and `.env.example` to describe the broker and the placeholder token in the isolated deployment, while keeping the existing environment-file instructions for the plain deployment. Verify: both paths are documented and neither is presented as the only option.
- [x] 7.3 Record in `DEPLOYMENT.md` the two rejected LLM-provider placements and what they cost (design.md — Decisions), so an operator hitting the memory limit knows the exits without rediscovering them. Verify: both alternatives are described with their trade-offs.
- [x] 7.4 Record in `DEPLOYMENT.md` why the token is not an `sbx secret`, and what the broker does and does not protect (design.md — Risks), so nobody "simplifies" it back into a managed secret that silently fails to authenticate. Verify: the header-vs-path reason and the broker's exposure are both stated.

## 8. Final verification

- [x] 8.1 Run `npm test` and `npx tsc --noEmit` on the host; both must pass. This change touches one file under `src/` (the Telegram base URL) plus the broker and its tests, so the suite is the guard that the plain deployment still behaves identically. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [x] 8.2 Confirm the plain Docker Compose deployment still works unchanged (covers "Host deployment still works"). Verify: `npm run docker:up` starts the stack and the bot replies to a message.
