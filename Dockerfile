FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

CMD ["node", "dist/index.js"]
