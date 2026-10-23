# motionframe v2 on Hugging Face Spaces (Docker, 2 vCPU / 16 GB RAM).
# Paste this as the only file "Dockerfile" in a new Docker Space. It pulls motionframe from GitHub.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg ca-certificates curl wget gnupg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git clone --depth 1 https://github.com/julius04-collab/motion-frame.git . && npm ci --ignore-scripts
RUN npx playwright install --with-deps chromium && (npx playwright install --with-deps chrome || true) && chmod -R a+rX /ms-playwright && chown -R 1000:1000 /app
ENV HOST=0.0.0.0 PORT=7860
EXPOSE 7860
CMD ["node", "v2/server.js"]
