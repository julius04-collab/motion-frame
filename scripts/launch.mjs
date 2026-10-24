// motionframe launch: runs the v2 studio on this computer and makes it public through a free
// Cloudflare tunnel, then points the landing page's buttons at the new link (landing/config.js + git push).
//   npm run launch            → start + update the landing page
//   npm run launch -- --no-push   → start without touching git
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4174);
const PUSH = !process.argv.includes('--no-push');
const isWin = process.platform === 'win32';
const say = (m) => console.log(`\x1b[1m[motionframe]\x1b[0m ${m}`);
const children = [];
const stop = () => { for (const c of children) { try { c.kill(); } catch { /* ignore */ } } process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

// 1. Find cloudflared: on PATH, or our own copy in bin/. If neither, download Cloudflare's official build once.
const BIN = path.join(ROOT, 'bin');
const local = path.join(BIN, isWin ? 'cloudflared.exe' : 'cloudflared');
const works = (cmd) => { try { return spawnSync(cmd, ['--version'], { shell: isWin && cmd === 'cloudflared' }).status === 0; } catch { return false; } };
let CF = process.env.CLOUDFLARED || (works('cloudflared') ? 'cloudflared' : local);
if (!works(CF)) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const asset = isWin ? `cloudflared-windows-${arch}.exe` : process.platform === 'darwin' ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
  const src = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  say('Downloading Cloudflare’s tunnel tool (one time, about 40 MB)…');
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(BIN, { recursive: true });
    const buf = Buffer.from(await r.arrayBuffer());
    if (asset.endsWith('.tgz')) { const tgz = path.join(BIN, 'cf.tgz'); fs.writeFileSync(tgz, buf); spawnSync('tar', ['-xzf', tgz, '-C', BIN]); fs.rmSync(tgz, { force: true }); }
    else fs.writeFileSync(local, buf);
    if (!isWin) fs.chmodSync(local, 0o755);
  } catch (e) {
    say(`Couldn't download it (${e.message}). Download this file in your browser and put it in the "bin" folder inside motion-frame:`);
    console.log('    ' + src + (isWin ? '\n    (keep the name cloudflared.exe)' : ''));
    process.exit(1);
  }
  CF = local;
  if (!works(CF)) { say('The downloaded tunnel tool won’t start. Send a screenshot of this window.'); process.exit(1); }
  say('Tunnel tool ready.');
}

// 2. Start the studio. It is public through the tunnel, so: block private addresses and keep rate limits on.
say('Starting the studio…');
const server = spawn(process.execPath, [path.join(ROOT, 'v2', 'server.js')], {
  cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), ALLOW_PRIVATE: '0', RATE_LIMIT: 'on' },
});
children.push(server);
server.on('exit', (c) => { say(`The studio stopped (code ${c}).`); stop(); });

const health = async (base) => { try { const r = await fetch(base + '/api/health', { cache: 'no-store' }); return r.ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await health(`http://127.0.0.1:${PORT}`)); i++) await new Promise((r) => setTimeout(r, 500));

// 3. Open the free tunnel and catch its link.
say('Opening the public link (Cloudflare)…');
const tunnel = spawn(CF, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { shell: isWin && CF === 'cloudflared', stdio: ['ignore', 'pipe', 'pipe'] });
children.push(tunnel);
let tail = [];
const keep = (d) => { tail.push(...String(d).split('\n').filter(Boolean)); tail = tail.slice(-6); };
tunnel.stdout.on('data', keep); tunnel.stderr.on('data', keep);
tunnel.on('exit', (c) => { say(`The tunnel closed (code ${c}). Cloudflare said:`); console.log(tail.map((l) => '    ' + l).join('\n')); stop(); });
const url = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('No link from Cloudflare after 60 s. Check your internet and run again.')), 60_000);
  const look = (d) => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(t); resolve(m[0]); } };
  tunnel.stdout.on('data', look); tunnel.stderr.on('data', look);
}).catch((e) => { say(e.message); stop(); });

// 4. Point the landing page at the new link.
const cfgPath = path.join(ROOT, 'landing', 'config.js');
const cfg = fs.readFileSync(cfgPath, 'utf8').replace(/appUrl:\s*'[^']*'/, `appUrl: '${url}'`);
fs.writeFileSync(cfgPath, cfg);
if (PUSH) {
  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', shell: isWin });
  git('add', 'landing/config.js');
  const c = git('commit', '-m', 'Update studio link');
  const p = git('push');
  if (p.status === 0) say('Landing page updated (Vercel redeploys in about a minute).');
  else say(`Couldn't push to GitHub (${(p.stderr || c.stderr || '').trim().split('\n').pop()}). Update landing/config.js by hand if needed.`);
}

// 5. Wait until the public link answers.
let ok = false;
for (let i = 0; i < 30 && !(ok = await health(url)); i++) await new Promise((r) => setTimeout(r, 2000));
if (ok) console.log('\n  ✅  motionframe is live:  ' + url + '\n  Keep this window open and your laptop awake. Press Ctrl+C to stop.\n');
else console.log('\n  ⚠️  The link was created but isn’t answering yet:  ' + url + '\n  Give it a minute and open it in your browser. If it never loads, press Ctrl+C and run again.\n');
