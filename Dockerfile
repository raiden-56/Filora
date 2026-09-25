# Single-container deployment: the Express API also serves the built React client.
# Used by Hugging Face Spaces (Docker SDK, port 7860) but runs anywhere Docker does.

# ---------- build ----------
FROM node:22-bookworm AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY packages/pdf-core/package.json packages/pdf-core/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Optional tools the server auto-detects for higher quality output.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      ghostscript qpdf poppler-utils \
      tesseract-ocr tesseract-ocr-eng \
      fonts-dejavu fonts-liberation fonts-noto-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/pdf-core/package.json packages/pdf-core/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Hugging Face runs containers as uid 1000 (the "node" user in this image).
RUN mkdir -p /tmp/pdfly && chown -R node:node /tmp/pdfly /app
USER node
ENV HOME=/home/node \
    PORT=7860 \
    HOST=0.0.0.0 \
    SERVE_CLIENT=true \
    CLIENT_DIST=/app/client/dist \
    TMP_DIR=/tmp/pdfly \
    TESSDATA_DIR=/tmp/pdfly-tessdata

WORKDIR /app/server
EXPOSE 7860
CMD ["node", "dist/index.js"]
