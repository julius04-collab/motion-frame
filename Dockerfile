# Runs motionframe anywhere Docker works (Railway, Render, Fly.io, a VPS).
FROM mcr.microsoft.com/playwright:v1.64.0-jammy
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts
RUN npx playwright install --with-deps chrome
COPY . .
ENV HOST=0.0.0.0 PORT=4173
EXPOSE 4173
CMD ["node", "server/index.js"]
