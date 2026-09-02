# Sandbox template for the isolated deployment (see DEPLOYMENT.md).
#
# The stock `docker/sandbox-templates:shell-docker` image ships Node 22, below
# the project's declared engines.node (>= 24). The bot does run on 22, but
# silently running under the declared floor is the kind of drift that produces
# a confusing failure later, so the template pins a supported Node.
#
# Node is installed here, on the host, rather than inside a live boundary:
# egress from a boundary is default-deny, and building this way means
# nodejs.org never has to appear in any boundary's allow list.

FROM docker/sandbox-templates:shell-docker

ARG NODE_VERSION=24.20.0

USER root

# /usr/local/bin precedes /usr/bin in PATH, so these symlinks shadow the
# distro's Node 22 without removing it.
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      arm64) node_arch=arm64 ;; \
      amd64) node_arch=x64 ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.gz" \
      -o /tmp/node.tar.gz; \
    mkdir -p /usr/local/node; \
    tar -xzf /tmp/node.tar.gz -C /usr/local/node --strip-components=1; \
    rm /tmp/node.tar.gz; \
    ln -sf /usr/local/node/bin/node /usr/local/bin/node; \
    ln -sf /usr/local/node/bin/npm /usr/local/bin/npm; \
    ln -sf /usr/local/node/bin/npx /usr/local/bin/npx; \
    node --version

USER agent
