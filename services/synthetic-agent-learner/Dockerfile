# Build context is the repository root so the service can use packages/.
FROM node:24-alpine

WORKDIR /app/services/synthetic-agent-learner

COPY services/synthetic-agent-learner/package.json services/synthetic-agent-learner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY packages /app/packages
COPY services/synthetic-agent-learner ./

EXPOSE 4200

CMD ["node", "index.js"]
