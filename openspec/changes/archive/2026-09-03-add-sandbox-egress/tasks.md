## 1. Configuration

- [x] 1.1 Add `resolveSandboxNetwork(raw: string | undefined): 'isolated' | 'egress'` to `src/config.ts`, defaulting to `'isolated'` and throwing `ConfigError` on any other value, and add `sandboxNetwork` to `AppConfig` and `loadConfig()`. Verify: `npx tsc --noEmit` passes.
- [x] 1.2 Add `resolveSandboxNetworkName(raw: string | undefined): string` to `src/config.ts` (env `SANDBOX_NETWORK_NAME`, default `telegram-agent-sandbox-net`) and wire it into `AppConfig`/`loadConfig()`. Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Unit-test both resolvers in `test/config.test.ts`: default, each explicit valid value, and that an unrecognized network mode throws `ConfigError`. Verify: `npm test` passes.

## 2. Sandbox image

- [x] 2.1 Add `curl` and `ca-certificates` to the `apk add` line in `sandbox/Dockerfile`. Verify: `npm run sandbox:build` succeeds and `docker run --rm telegram-agent-sandbox curl --version` prints a version.
- [x] 2.2 Verify TLS works from the image: `docker run --rm --network bridge telegram-agent-sandbox curl -sS https://wttr.in/Minsk?0` returns a response rather than a certificate error (covers spec scenario "HTTP client is available for networked skills"). Verify: the command prints weather output.

## 3. Network provisioning

- [x] 3.1 In `src/sandbox/docker-cli.ts`, add a helper that ensures a Docker network exists: check for it, create it if absent, and treat a "network already exists" failure from a lost race as success rather than an error. Keep it injectable in the same style as the existing `DockerExecFn` so it can be faked. Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Unit-test the helper in `test/sandbox/docker-cli.test.ts` with a fake exec: network missing → create is invoked; network present → create is not invoked (covers spec scenarios "Network is missing on first use" and "Network already exists"); create fails with an "already exists" error → the helper resolves rather than rejecting. Verify: `npm test` passes.

## 4. Executor wiring

- [x] 4.1 In `src/sandbox/sandbox-executor.ts`, replace the hardcoded `'--network', 'none'` with arguments derived from the configured mode: isolated → `--network none`; egress → `--network <configured network name>`. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 In egress mode only, ensure the network exists before the first sandbox is spawned, using the helper from task 3.1. Do not provision anything in isolated mode. Verify: `npx tsc --noEmit` passes.
- [x] 4.3 Log the active sandbox network mode once at startup from `src/index.ts` (covers spec scenario "Configured mode is visible at startup"). Verify: `npm run dev` prints the mode in the startup logs.

## 5. Executor tests

- [x] 5.1 In `test/sandbox/sandbox-executor.test.ts`, assert with a fake docker exec that the default configuration spawns the container with `--network none` (covers "Default configuration is fully isolated" and "Isolated mode is explicitly configured"). Verify: `npm test` passes.
- [x] 5.2 Assert that egress mode spawns the container with `--network <configured name>` and that the network-ensure helper was called exactly once across multiple `execute()` calls. Verify: `npm test` passes.
- [x] 5.3 Assert that isolated mode never calls the network-ensure helper (covers "Isolated mode provisions nothing"). Verify: `npm test` passes.

## 6. Manual isolation checks

These verify spec scenarios that cannot be asserted with fakes, because they are properties of Docker's networking rather than of this codebase.

- [x] 6.1 With `SANDBOX_NETWORK=egress`, send the bot a message that makes it run `curl -sS https://wttr.in/Minsk?0` in the sandbox and confirm weather output comes back (covers "Egress mode reaches a public endpoint"). Verify: the reply contains the fetched content.
- [x] 6.2 With `SANDBOX_NETWORK=egress` and the Docker stack running, run a tool call attempting to reach the LLM provider container by service name (e.g. `curl -sS --max-time 5 http://ollama:11434/api/tags`) and confirm it fails to connect (covers "Egress mode cannot reach the agent's own services"). Verify: the tool result is a connection failure, not a model list.
- [x] 6.3 With `SANDBOX_NETWORK=egress`, confirm `curl --max-time 5 --unix-socket /var/run/docker.sock http://localhost/version` inside the sandbox fails because the socket is not mounted (covers "Egress mode does not expose the Docker API"). Verify: the tool result reports the socket is missing.
- [x] 6.4 With the default configuration, repeat task 6.1 and confirm the request fails (covers "Default configuration is fully isolated" end to end). Verify: the tool result is a network failure.

## 7. Documentation

- [x] 7.1 Document `SANDBOX_NETWORK` and `SANDBOX_NETWORK_NAME` in `.env.example`, stating that the default is full isolation and that egress mode requires rebuilding the sandbox image. Verify: the file lists both variables with their defaults.
- [x] 7.2 Add a section to `README.md` covering the two modes, what egress mode keeps unreachable, the residual risk that the host remains addressable through the Docker gateway, and the guidance that egress mode belongs inside the isolation boundary where that risk is bounded (see design.md — Risks). Update the existing sandbox description, which currently states unconditionally that the sandbox has no network access. Verify: README no longer claims network isolation is unconditional, and points to the isolated deployment as the intended home for egress mode.

## 8. Final verification

- [x] 8.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
