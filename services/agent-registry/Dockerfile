# Build context is the repository root so the service can use packages/.
FROM node:24-alpine

WORKDIR /app/services/agent-registry

COPY services/agent-registry/package.json services/agent-registry/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY packages /app/packages
COPY services/agent-registry ./

EXPOSE 4001

CMD ["node", "index.js"]
