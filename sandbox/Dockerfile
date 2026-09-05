FROM alpine:latest

ARG TARGETARCH
ARG RTK_VERSION=0.48.0
# Pinned from https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/checksums.txt -
# verified below so a compromised release asset fails the build rather than
# landing silently. RTK is a compiled binary inside the boundary around
# commands the model chooses, unlike this repo's own TypeScript - see
# design.md, "Putting a third-party binary inside the sandbox is a security
# decision, and is recorded as one."
ARG RTK_SHA256_AMD64=e4e650fa1677c0de2f6839a6040d7b17f312d32f163c402b75af70e9e5af1a91

# amd64 only: RTK ships no musl build for arm64 (only a glibc/"gnu" one), and
# that glibc build does not run on musl-based alpine even with `gcompat`
# installed - `fcntl64`/`__res_init` still fail to relocate (confirmed by
# building this image; see design.md, "The RTK binary may not run in the
# sandbox image at all"). Building on an arm64 host fails fast here rather
# than silently shipping a sandbox image without compression - see
# README.md's "Shell-output compression (RTK)" section for the arm64
# limitation and how to build for amd64 (e.g. via `docker buildx build
# --platform linux/amd64`) if that is required.
RUN apk add --no-cache coreutils curl ca-certificates \
    && if [ "$TARGETARCH" != "amd64" ]; then \
         echo "RTK has no working build for architecture '$TARGETARCH' on alpine (musl) - see README.md's RTK section. Build with --platform linux/amd64 to include RTK, or remove it from this Dockerfile for a $TARGETARCH-only deployment." >&2; \
         exit 1; \
       fi \
    && RTK_ASSET="rtk-x86_64-unknown-linux-musl.tar.gz" \
    && RTK_SHA256="$RTK_SHA256_AMD64" \
    && curl -fsSL -o /tmp/rtk.tar.gz "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${RTK_ASSET}" \
    && echo "${RTK_SHA256}  /tmp/rtk.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rtk.tar.gz -C /tmp \
    && install -m 0755 /tmp/rtk /usr/local/bin/rtk \
    && rm -rf /tmp/rtk.tar.gz /tmp/rtk \
    && rtk --version

WORKDIR /work

CMD ["sleep", "infinity"]
