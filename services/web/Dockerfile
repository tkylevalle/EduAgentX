# Build context is the repository root so the server can use packages/.
FROM node:24-alpine AS build
WORKDIR /app/services/web
COPY services/web/package.json services/web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY services/web ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app/services/web
COPY services/web/package.json services/web/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/web/server.js ./
COPY services/curriculum-engine/model.js services/curriculum-engine/fallback.js /app/services/curriculum-engine/
COPY services/curriculum-engine/examples /app/services/curriculum-engine/examples
COPY --from=build /app/services/web/dist ./dist
EXPOSE 4300
CMD ["node", "server.js"]
