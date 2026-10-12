FROM node:24-alpine
WORKDIR /app/services/examination-engine
COPY services/examination-engine/package.json services/examination-engine/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/curriculum-engine/model.js /app/services/curriculum-engine/model.js
COPY services/curriculum-engine/fallback.js /app/services/curriculum-engine/fallback.js
COPY services/examination-engine ./
EXPOSE 4005
CMD ["node", "index.js"]
