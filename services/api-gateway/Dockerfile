# Build context is the repository root so the service can use packages/.
FROM node:24-alpine

WORKDIR /app/services/api-gateway

COPY services/api-gateway/package.json services/api-gateway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY packages /app/packages
COPY services/api-gateway ./

EXPOSE 4000

CMD ["node", "index.js"]
