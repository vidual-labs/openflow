#!/usr/bin/env node
// Renders openflow-promo.html to an MP4, frame by frame.
//
//   node docs/video/render.mjs [--fps 60] [--out docs/video/openflow-promo.mp4]
//                              [--from 0] [--to <end>] [--stills 1.2,5,9.5]
//
// Needs ffmpeg on the PATH and Playwright (project-local, or a global
// `npm i -g playwright` with its Chromium). The page renders each frame as a
// pure function of time (`window.renderFrame(t)`), so nothing depends on how
// fast screenshots are taken. --stills writes PNGs at the given times instead
// of a video (handy for checking a cut).
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const fps = Number(args.fps || 60);
const out = path.resolve(args.out || path.join(here, 'openflow-promo.mp4'));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return import(pathToFileURL(path.join(root, 'playwright', 'index.mjs')).href);
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.goto(`${pathToFileURL(path.join(here, 'openflow-promo.html')).href}?render=1`);
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);

if (args.stills) {
  const dir = path.resolve(args.dir || path.join(here, 'stills'));
  mkdirSync(dir, { recursive: true });
  for (const t of args.stills.split(',').map(Number)) {
    await page.evaluate(x => window.renderFrame(x), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(2)}.png`) });
  }
  await browser.close();
  console.log(`stills written to ${dir}`);
  process.exit(0);
}

const from = Number(args.from || 0);
const to = Math.min(Number(args.to || duration), duration);
const frames = Math.round((to - from) * fps);

const ffmpeg = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-movflags', '+faststart', '-an',
  out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((resolve, reject) => ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));

for (let i = 0; i < frames; i++) {
  await page.evaluate(x => window.renderFrame(x), from + i / fps);
  const png = await page.screenshot({ type: 'png' });
  if (!ffmpeg.stdin.write(png)) await new Promise(r => ffmpeg.stdin.once('drain', r));
  if (i % fps === 0) process.stdout.write(`\r${(i / fps).toFixed(0)}s / ${(frames / fps).toFixed(0)}s`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(`\nwrote ${out} (${frames} frames @ ${fps} fps, ${(to - from).toFixed(1)} s)`);
