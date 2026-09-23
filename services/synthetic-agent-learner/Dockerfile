FROM node:20-alpine

WORKDIR /app

COPY services/synthetic-agent-learner/package.json ./services/synthetic-agent-learner/
RUN cd services/synthetic-agent-learner && npm install --omit=dev

COPY services/synthetic-agent-learner/index.js services/synthetic-agent-learner/gateway-client.js services/synthetic-agent-learner/learner.js services/synthetic-agent-learner/profiles.js ./services/synthetic-agent-learner/
COPY services/external-agent-protocol ./services/external-agent-protocol

EXPOSE 4200

WORKDIR /app/services/synthetic-agent-learner

CMD ["node", "index.js"]
