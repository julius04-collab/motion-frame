# motionframe
Turn live sites into launch-ready films: paste a URL, pick a device + backdrop, download an MP4 of the whole page scrolling inside a mockup.

## Run
```
npm install          # also downloads Chromium via Playwright
npm start            # http://127.0.0.1:4173
```
Env: `PORT`, `HOST`, `ALLOW_PRIVATE=1` (allow localhost/LAN targets when exposed), `CHROMIUM_PATH`, `FFMPEG_PATH`.

## How it works
1. `/api/capture` loads the site in headless Chromium at the device viewport, scrolls once to trigger lazy content, and stores tall JPEG strips.
2. `public/compose.html` is the scene (backdrop + mockup + scrolling page). The UI shows it live in an iframe.
3. `/api/render` steps that same scene frame by frame, screenshots each frame and pipes them to ffmpeg → H.264 MP4 (1080p or 4K, 30/60 fps).

## Page motion
- **Live** (default): records the real page with a controlled clock, so CSS/JS animations, background `<video>`, scroll reveals and sticky headers all appear in the film. Uses installed Google Chrome when found (needed for .mp4/H.264 hero videos), otherwise Playwright's Chromium.
- **Still**: scrolls one screenshot of the page. Fastest, but nothing on the page animates.

## Troubleshooting
- `spawn EFTYPE` / "video encoder couldn't start": the bundled ffmpeg is broken. motionframe now tests each candidate and falls back; if all fail, install ffmpeg from ffmpeg.org, add it to PATH (or set `FFMPEG_PATH`), restart.

## Deploying
motionframe needs a real server: it runs headless Chrome and ffmpeg for up to a few minutes per film and keeps jobs in memory. That does **not** fit Vercel's serverless functions (the page loads, but capture/render can't run). Use the included `Dockerfile` on Railway, Render, Fly.io or any VPS. On a public host, private/local addresses are blocked automatically.
