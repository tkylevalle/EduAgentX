# Build context is the repository root so the service can use packages/.
FROM node:24-alpine

WORKDIR /app/services/assurance-console

COPY services/assurance-console/package.json services/assurance-console/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY packages /app/packages
COPY services/assurance-console ./

EXPOSE 4100

CMD ["node", "index.js"]
