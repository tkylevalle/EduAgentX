# Build context is the repository root so the service can use packages/.
FROM node:24-alpine
WORKDIR /app/services/marketplace-service
COPY services/marketplace-service/package.json services/marketplace-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/marketplace-service ./
EXPOSE 4012
CMD ["node", "index.js"]
