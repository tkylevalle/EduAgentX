FROM node:24-slim
WORKDIR /app/services/curriculum-index
COPY services/curriculum-index/package.json services/curriculum-index/package-lock.json ./
RUN npm ci --omit=dev
COPY services/curriculum-index ./
EXPOSE 4003
CMD ["node", "index.js"]