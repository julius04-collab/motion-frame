# Runs motionframe anywhere Docker works (Render, Railway, Fly.io, a VPS).
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl wget gnupg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
# Chromium always; Google Chrome too when possible (it can play .mp4 background videos, Chromium can't).
RUN npx playwright install --with-deps chromium \
 && (npx playwright install --with-deps chrome || echo "Google Chrome not installed; using Chromium only")
COPY . .
ENV HOST=0.0.0.0 PORT=4173 NODE_ENV=production
EXPOSE 4173
CMD ["node", "server/index.js"]
