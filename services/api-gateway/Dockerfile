FROM node:20-alpine

WORKDIR /app

COPY services/api-gateway/package.json ./services/api-gateway/
RUN cd services/api-gateway && npm install --omit=dev

COPY services/api-gateway/index.js services/api-gateway/auth.js services/api-gateway/telemetry.js ./services/api-gateway/
COPY services/external-agent-protocol ./services/external-agent-protocol

EXPOSE 4000

WORKDIR /app/services/api-gateway

CMD ["node", "index.js"]
