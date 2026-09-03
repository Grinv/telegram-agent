# Throwaway image for running the benchmark against a Docker Compose
# deployment, where Ollama is only reachable on the internal `bot-net`
# network (see docker-compose.yml's `benchmark` service and README.md's
# Benchmark section). Unlike the bot's own Dockerfile, this installs full
# devDependencies (tsx, typescript) since the benchmark runs from source.
FROM node:24-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
COPY benchmark/ ./benchmark/
RUN npm ci
