FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV CODEX_HOME=/codex

COPY package.json ./
COPY src ./src

RUN mkdir -p /codex && chown -R node:node /app /codex

USER node

CMD ["node", "src/index.js"]
