FROM node:24-alpine
WORKDIR /app/services/curriculum-engine
COPY services/curriculum-engine/package.json services/curriculum-engine/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/curriculum-engine ./
EXPOSE 4002
CMD ["node", "index.js"]
