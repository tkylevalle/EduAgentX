FROM node:24-slim
WORKDIR /app/services/curriculum-index
COPY services/curriculum-index/package.json services/curriculum-index/package-lock.json ./
# The embedder runs on the CPU. Without this, onnxruntime-node's install script
# downloads its CUDA binaries on Linux x64, and a moved release asset (404)
# fails the whole build.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci --omit=dev
COPY services/curriculum-index ./
EXPOSE 4003
CMD ["node", "index.js"]