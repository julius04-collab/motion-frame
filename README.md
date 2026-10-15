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
- Hero video missing in Live films on Linux/Codespaces: run `npx playwright install chrome` (real Chrome plays .mp4/H.264; Playwright's Chromium can't) and restart.
- `spawn EFTYPE` / "video encoder couldn't start": the bundled ffmpeg is broken. motionframe now tests each candidate and falls back; if all fail, install ffmpeg from ffmpeg.org, add it to PATH (or set `FFMPEG_PATH`), restart.

## Deploying
motionframe needs a real server: it runs headless Chrome and ffmpeg for up to a few minutes per film and keeps jobs in memory. That does **not** fit Vercel's serverless functions (the page loads, but capture/render can't run). Easiest: tap **Deploy to Render** — https://render.com/deploy?repo=https://github.com/julius04-collab/motion-frame (uses `render.yaml`, works from a phone). The `Dockerfile` also runs on Railway, Fly.io or any VPS. On a public host, private/local addresses are blocked automatically.

### Free option: GitHub Codespaces (works from a phone)
Repo page → **Code → Codespaces → Create codespace on main**. It installs everything and starts motionframe automatically; open the forwarded port 4173 from the **Ports** tab. Free accounts get a monthly allowance of Codespaces hours; stop the codespace when you're done.

## Running it publicly
- Rate limits are on automatically when the server isn't bound to localhost: 6 renders and 30 site loads per IP per 15 minutes, and one active render per IP. Tune with `RENDERS_PER_15MIN`, `CAPTURES_PER_15MIN`, or turn off with `RATE_LIMIT=off`.
- Private/local addresses are blocked for visited sites (SSRF protection) unless `ALLOW_PRIVATE=1`.
- Finished videos and captures are deleted after 2 hours.
