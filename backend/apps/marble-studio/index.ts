import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const WORLDLABS_API = 'https://api.worldlabs.ai/marble/v1';
const ENC_PREFIX = 'enc:';

interface MarbleWorld {
    id: number;
    name: string;
    prompt: string;
    prompt_type: string;
    model: string;
    world_id: string | null;
    operation_id: string | null;
    status: string;
    error_msg: string | null;
    assets_json: string | null;
    thumbnail_url: string | null;
    caption: string | null;
    created_at: string;
}

function ensureSettingsTable(db: InstanceType<typeof Database>) {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS marble_studio_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();
}

// ── Encryption helpers ────────────────────────────────────────────────────────

/**
 * Get or lazily create a per-workspace AES-256-GCM encryption key.
 * Stored as hex in the settings table under the internal key `__encrypt_key__`.
 */
function getOrCreateEncKey(db: InstanceType<typeof Database>): Buffer {
    const row = db.prepare('SELECT value FROM marble_studio_settings WHERE key=?')
        .get('__encrypt_key__') as { value: string } | undefined;
    if (row) return Buffer.from(row.value, 'hex');
    const key = randomBytes(32);
    db.prepare('INSERT OR REPLACE INTO marble_studio_settings (key, value) VALUES (?, ?)')
        .run('__encrypt_key__', key.toString('hex'));
    return key;
}

/**
 * Encrypt a plaintext value and return an `enc:<iv>.<tag>.<ciphertext>` string.
 * Uses AES-256-GCM with a fresh random IV for each call.
 */
function encryptValue(plaintext: string, key: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + [iv, tag, ciphertext].map(b => b.toString('base64')).join('.');
}

/**
 * Decrypt a value produced by `encryptValue`.
 * If the value does not start with `enc:` it is returned as-is (backward compat
 * for any values stored before encryption was introduced).
 */
function decryptValue(stored: string, key: Buffer): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    try {
        const parts = stored.slice(ENC_PREFIX.length).split('.');
        if (parts.length !== 3) return stored; // malformed — return raw
        const [ivB64, tagB64, cipherB64] = parts;
        const iv         = Buffer.from(ivB64,     'base64');
        const tag        = Buffer.from(tagB64,    'base64');
        const ciphertext = Buffer.from(cipherB64, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        // Decryption failure — return raw value rather than crashing
        return stored;
    }
}

// ── Settings helpers ──────────────────────────────────────────────────────────

function getApiKey(db: InstanceType<typeof Database>): string | null {
    const row = db.prepare('SELECT value FROM marble_studio_settings WHERE key=?')
        .get('api_key') as { value: string } | undefined;
    if (!row?.value) return null;
    const encKey = getOrCreateEncKey(db);
    return decryptValue(row.value, encKey);
}

function keyHint(key: string): string {
    // Show last 4 chars like "****...ksqB"
    if (key.length <= 4) return '****';
    return `****...${key.slice(-4)}`;
}

// ── Inline viewer HTML ────────────────────────────────────────────────────────
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #050508; }
    #canvas { width: 100%; height: 100%; display: block; }
    #loader {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: #050508;
      color: rgba(255,255,255,0.55); font-family: system-ui, sans-serif; gap: 18px;
      transition: opacity 0.5s ease;
    }
    #loader.hidden { opacity: 0; pointer-events: none; }
    #pcanvas { display: block; }
    #progress-track { width: 180px; height: 2px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
    #progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4ade80, #84cc16); transition: width 0.15s; }
    #label { font-size: 12px; letter-spacing: 0.06em; opacity: 0.7; }
    #error-msg {
      position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
      background: #050508; color: #f87171; font-family: system-ui, sans-serif; font-size: 13px;
      text-align: center; padding: 32px; line-height: 1.6;
    }
    /* ── Drag invite hint ────────────────────────────────────────────────────── */
    #drag-hint {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      pointer-events: none; transition: opacity 1s ease;
    }
    #drag-hint.hidden { opacity: 0; }
    .drag-arrows { display: flex; align-items: center; gap: 22px; }
    .drag-hand-svg {
      width: 58px; height: 58px; color: rgba(132,204,22,0.85);
      filter: drop-shadow(0 0 14px rgba(132,204,22,0.45));
      animation: drag-sway 2.2s ease-in-out infinite alternate;
    }
    @keyframes drag-sway {
      0%   { transform: translateX(-12px) rotate(-7deg); }
      100% { transform: translateX(12px) rotate(7deg); }
    }
    .drag-arr-left  { animation: arr-left-pulse  2.2s ease-in-out infinite alternate; }
    .drag-arr-right { animation: arr-right-pulse 2.2s ease-in-out infinite alternate; }
    @keyframes arr-left-pulse {
      0%   { opacity: 0.65; transform: translateX(-3px); }
      100% { opacity: 0.1;  transform: translateX(3px); }
    }
    @keyframes arr-right-pulse {
      0%   { opacity: 0.1;  transform: translateX(-3px); }
      100% { opacity: 0.65; transform: translateX(3px); }
    }
    .drag-label {
      font-family: system-ui, sans-serif; font-size: 11px; letter-spacing: 0.1em;
      text-transform: uppercase; color: rgba(255,255,255,0.28);
    }
    #res-toggle {
      position: absolute; top: 12px; right: 12px; display: flex; gap: 4px;
      background: rgba(0,0,0,0.5); border-radius: 6px; padding: 3px;
    }
    .res-btn {
      padding: 3px 8px; border-radius: 4px; border: none; background: transparent;
      color: rgba(255,255,255,0.4); font-size: 10px; cursor: pointer; font-family: system-ui;
      transition: all 0.15s;
    }
    .res-btn:hover { color: rgba(255,255,255,0.8); }
    .res-btn.active { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.9); }

    /* ── Crossfade overlay ───────────────────────────────────────────────────── */
    #crossfade {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none; opacity: 0;
    }

    /* ── Quality upgrade transition effects ─────────────────────────────────── */
    @keyframes pulse-ring {
      0%   { box-shadow: inset 0 0 0 1px rgba(132,204,22,0.15), 0 0 24px rgba(132,204,22,0.04); }
      50%  { box-shadow: inset 0 0 0 2px rgba(132,204,22,0.55), 0 0 48px rgba(132,204,22,0.18); }
      100% { box-shadow: inset 0 0 0 1px rgba(132,204,22,0.15), 0 0 24px rgba(132,204,22,0.04); }
    }
    @keyframes swap-reveal {
      0%   { opacity: 0; }
      15%  { opacity: 1; }
      100% { opacity: 0; }
    }
    #upgrade-ring {
      position: absolute; inset: 0; pointer-events: none; border-radius: 0;
      opacity: 0; transition: opacity 0.5s ease;
    }
    #upgrade-ring.active {
      opacity: 1;
      animation: pulse-ring 1.6s ease-in-out infinite;
    }
    #swap-flash {
      position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse at 50% 50%, rgba(132,204,22,0.22) 0%, rgba(132,204,22,0.06) 40%, transparent 70%);
      opacity: 0;
    }
    #swap-flash.active {
      animation: swap-reveal 0.8s cubic-bezier(0.4,0,0.2,1) forwards;
    }
  </style>
</head>
<body>
<canvas id="canvas"></canvas>
<canvas id="crossfade"></canvas>
<div id="loader">
  <canvas id="pcanvas" width="160" height="160"></canvas>
  <div id="label">Loading world…</div>
  <div id="progress-track"><div id="progress-fill"></div></div>
</div>
<div id="error-msg"></div>
<div id="upgrade-ring"></div>
<div id="swap-flash"></div>
<div id="drag-hint">
  <div class="drag-arrows">
    <svg class="drag-arr-left" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(132,204,22,0.5)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    <svg class="drag-hand-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/>
      <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
      <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    </svg>
    <svg class="drag-arr-right" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(132,204,22,0.5)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </div>
  <span class="drag-label">drag to explore</span>
</div>
<div id="res-toggle" style="display:none">
  <button class="res-btn" data-res="100k">100k</button>
  <button class="res-btn active" data-res="500k">500k</button>
  <button class="res-btn" data-res="full_res">Full</button>
</div>
<div id="quality-badge" style="
  position:absolute; bottom:14px; left:14px;
  background: rgba(0,0,0,0.5); border-radius: 4px;
  padding: 2px 7px; font-size: 10px; font-family: system-ui;
  color: rgba(255,255,255,0.45); display: none; letter-spacing: 0.04em;
"></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.178.0/three.module.js",
    "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.10/spark.module.js"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, SplatLoader, SparkControls } from '@sparkjsdev/spark';

const params = new URLSearchParams(location.search);
const assetsParam = params.get('assets');
const loader = document.getElementById('loader');
const progressFill = document.getElementById('progress-fill');
const label = document.getElementById('label');
const errorMsg = document.getElementById('error-msg');
const dragHint = document.getElementById('drag-hint');
const resToggle = document.getElementById('res-toggle');
function hideDragHint() { dragHint.classList.add('hidden'); }

let assetsData = null;
try { assetsData = assetsParam ? JSON.parse(decodeURIComponent(assetsParam)) : null; } catch {}

const spzUrls = assetsData?.splats?.spz_urls || {};
const hasUrls = Object.keys(spzUrls).length > 0;
const forcedUrl = params.get('url');
const defaultUrl = forcedUrl || spzUrls['100k'] || spzUrls['150k'] || spzUrls['500k'] || spzUrls['full_res'];
const defaultQuality = params.get('active_res') || (spzUrls['100k'] ? '100k' : (spzUrls['150k'] ? '150k' : '500k'));

// ── Particle sphere animation ─────────────────────────────────────────────────
const pcanvas = document.getElementById('pcanvas');
const pctx = pcanvas.getContext('2d');
const N = 90;

const particles = Array.from({length: N}, (_, i) => {
  const phi = Math.acos(1 - 2*(i+0.5)/N);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return {
    basePhi: phi,
    baseTheta: theta,
    speed: 0.0004 + (i % 7) * 0.00008,
    offset: (i / N) * Math.PI * 2,
  };
});

let pAnimId = null;
let pTime = 0;

function animateParticles() {
  pTime++;
  pctx.clearRect(0, 0, 160, 160);
  const cx = 80, cy = 80, r = 58;

  const pts = particles.map(p => {
    const t = p.baseTheta + pTime * p.speed;
    const x = Math.sin(p.basePhi) * Math.cos(t);
    const y = Math.cos(p.basePhi);
    const z = Math.sin(p.basePhi) * Math.sin(t);
    return { x, y, z };
  });

  pts.sort((a, b) => a.z - b.z);

  for (const p of pts) {
    const depth = (p.z + 1) / 2;
    const alpha = 0.12 + depth * 0.82;
    const size = 0.8 + depth * 2.4;
    const px = cx + p.x * r;
    const py = cy + p.y * r;
    pctx.beginPath();
    pctx.arc(px, py, size, 0, Math.PI * 2);
    pctx.fillStyle = 'rgba(132,204,22,' + alpha.toFixed(2) + ')';
    pctx.fill();
  }

  pAnimId = requestAnimationFrame(animateParticles);
}

function startParticleAnim() { if (!pAnimId) animateParticles(); }
function stopParticleAnim() { if (pAnimId) { cancelAnimationFrame(pAnimId); pAnimId = null; } }

// ── Loader helpers ────────────────────────────────────────────────────────────
function showLoader(msg) {
  progressFill.style.width = '0%';
  label.textContent = msg || 'Loading world\u2026';
  loader.classList.remove('hidden');
  startParticleAnim();
}

function hideLoader() {
  loader.classList.add('hidden');
  stopParticleAnim();
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
}

function showError(msg) {
  errorMsg.style.display = 'flex';
  errorMsg.textContent = msg;
}

function setQualityIndicator(quality, upgrading) {
  const badge = document.getElementById('quality-badge');
  if (!badge) return;
  badge.style.display = 'block';
  badge.textContent = upgrading ? quality + ' \u00b7 upgrading\u2026' : quality;
  badge.style.color = upgrading ? 'rgba(132,204,22,0.6)' : 'rgba(255,255,255,0.35)';
}

function updateResButtons(quality) {
  resToggle.querySelectorAll('.res-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.res === quality);
  });
}

const upgradeRing = document.getElementById('upgrade-ring');
const swapFlash   = document.getElementById('swap-flash');

function showUpgradeRing() {
  upgradeRing.classList.add('active');
}
function hideUpgradeRing() {
  upgradeRing.classList.remove('active');
}
function triggerSwapFlash() {
  swapFlash.classList.remove('active');
  // Force reflow so re-adding the class restarts the animation
  void swapFlash.offsetWidth;
  swapFlash.classList.add('active');
  swapFlash.addEventListener('animationend', () => swapFlash.classList.remove('active'), { once: true });
}

// Start particle anim immediately so the user sees it during initial load
startParticleAnim();

if (!defaultUrl) {
  hideLoader();
  showError('No world URL provided');
} else {
  const canvas = document.getElementById('canvas');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, 1, 0.01, 1000);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const spark = new SparkRenderer({ renderer, view: { sort32: true, sort360: true } });
  scene.add(spark);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  function resize() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
    const h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  const controls = new SparkControls({ canvas });
  controls.pointerControls.reverseRotate = true;
  controls.pointerControls.slideSpeed = 0.5;
  controls.pointerControls.scrollSpeed = 0.3;

  let world = null;
  let currentQuality = null;
  let upgrading = false;
  let isFirstLoad = true;
  let depthRevealFn = null; // fn(now:number) → bool (true=continue)

  canvas.addEventListener('pointerdown', hideDragHint, { once: true });

  renderer.setAnimationLoop((now) => {
    if (world) controls.update(camera);
    if (depthRevealFn && !depthRevealFn(now)) depthRevealFn = null;
    renderer.render(scene, camera);
  });

  setTimeout(hideDragHint, 7000);

  // ── Depth reveal: sweeps camera.far from near → far over durationMs ──────────
  // Creates the "world builds from camera outward" effect on initial load.
  // Uses camera.far (projection matrix) so it works universally with SparkJS splats.
  function startDepthReveal(durationMs) {
    depthRevealFn = null;            // cancel any previous
    camera.far = 1.2;
    camera.updateProjectionMatrix();
    let t0 = null;
    depthRevealFn = (now) => {
      if (t0 === null) t0 = now;
      const t = Math.min((now - t0) / durationMs, 1);
      // Ease-out cubic: near objects reveal quickly, distant ones slow
      const eased = 1 - Math.pow(1 - t, 3);
      camera.far = 1.2 + 998.8 * eased;
      camera.updateProjectionMatrix();
      if (t >= 1) {
        camera.far = 1000;
        camera.updateProjectionMatrix();
        return false; // done
      }
      return true;
    };
  }

  async function loadSplat(url, quality) {
    currentQuality = quality;
    if (world) { scene.remove(world); world.dispose(); world = null; }
    showLoader(quality === '100k' ? 'Loading world\u2026' : 'Upgrading to ' + quality + '\u2026');

    try {
      const splatLoader = new SplatLoader();
      const packed = await splatLoader.loadAsync(url, (evt) => {
        if (evt.total > 0) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          setProgress(pct);
        }
      });
      world = new SplatMesh({ packedSplats: packed });
      
      const safeFloat = (val, fb) => { const p = parseFloat(val); return isNaN(p) ? fb : p; };
      const hasPos = params.has('cpx') && !isNaN(parseFloat(params.get('cpx')));
      
      if (hasPos) {
        world.quaternion.set(
          safeFloat(params.get('wqx'), 1), safeFloat(params.get('wqy'), 0),
          safeFloat(params.get('wqz'), 0), safeFloat(params.get('wqw'), 0)
        );
      } else {
        world.quaternion.set(1, 0, 0, 0);
      }
      
      scene.add(world);
      
      if (isFirstLoad) {
        if (hasPos) {
          camera.position.set(
            safeFloat(params.get('cpx'), 0), safeFloat(params.get('cpy'), 0), safeFloat(params.get('cpz'), 0)
          );
          camera.quaternion.set(
            safeFloat(params.get('cqx'), 0), safeFloat(params.get('cqy'), 0), safeFloat(params.get('cqz'), 0), safeFloat(params.get('cqw'), 1)
          );
        } else {
          camera.position.set(0, 0, 0);
          camera.quaternion.set(0, 0, 0, 1);
        }
        isFirstLoad = false;
        hideLoader();
        if (!hasPos) startDepthReveal(1800); // near→far sweep on first world load
      } else {
        hideLoader();
      }
      updateResButtons(quality);

      // Auto-upgrade: after 100k loads, silently fetch 500k
      if (quality === '100k' && spzUrls['500k'] && !upgrading) {
        upgrading = true;
        setQualityIndicator('100k', true);
        setTimeout(() => silentUpgrade('500k', spzUrls['500k']), 300);
      } else {
        setQualityIndicator(quality, false);
      }
    } catch (err) {
      hideLoader();
      showError('Failed to load world: ' + (err.message || err));
      console.error(err);
    }
  }

  async function silentUpgrade(quality, url) {
    showUpgradeRing();

    try {
      const splatLoader = new SplatLoader();
      const packed = await splatLoader.loadAsync(url);

      // ── 1. Freeze current frame ────────────────────────────────────────────────
      const xfade = document.getElementById('crossfade');
      const xctx = xfade.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      xfade.width  = Math.round(rect.width);
      xfade.height = Math.round(rect.height);
      xctx.drawImage(canvas, 0, 0, xfade.width, xfade.height);

      // Snapshot as ImageBitmap so we can redraw it on every animation frame
      const frozenBitmap = await createImageBitmap(xfade);

      xfade.style.transition = 'none';
      xfade.style.opacity = '1';

      // ── 2. Swap the world underneath (hidden behind overlay) ──────────────────
      const camPos = camera.position.clone();
      const camQuat = camera.quaternion.clone();

      if (world) { scene.remove(world); world.dispose(); }
      world = new SplatMesh({ packedSplats: packed });
      world.quaternion.set(1, 0, 0, 0);
      scene.add(world);

      camera.position.copy(camPos);
      camera.quaternion.copy(camQuat);

      hideUpgradeRing();
      currentQuality = quality;
      upgrading = false;
      updateResButtons(quality);
      setQualityIndicator(quality, false);

      // ── 3. Radial reveal: erases frozen frame center-outward ──────────────────
      // Mimics depth-based loading — near geometry (center of view) resolves first,
      // far geometry (periphery) resolves last.  The new hi-res world shines through
      // the expanding hole while the old blurry frame fades away from the edges.
      const cx = xfade.width  / 2;
      const cy = xfade.height / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy) * 1.15; // large enough to cover corners
      const duration = 3200; // ms — slow, deliberate reveal
      const start = performance.now();

      function revealFrame(now) {
        const raw = Math.min((now - start) / duration, 1);
        // Ease-out: center clears quickly, outer edges fade gently (near→far)
        const t = 1 - Math.pow(1 - raw, 2.2);
        const outerR = Math.max(0.5, t * maxR);
        const innerR = Math.max(0.1, outerR * 0.55);

        // Redraw frozen bitmap each frame
        xctx.globalCompositeOperation = 'source-over';
        xctx.clearRect(0, 0, xfade.width, xfade.height);
        xctx.drawImage(frozenBitmap, 0, 0);

        // Punch an expanding transparent hole via destination-out compositing
        xctx.globalCompositeOperation = 'destination-out';
        const grad = xctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
        grad.addColorStop(0, 'rgba(0,0,0,1)'); // fully erased at center
        grad.addColorStop(1, 'rgba(0,0,0,0)'); // fully opaque at outer edge
        xctx.fillStyle = grad;
        xctx.fillRect(0, 0, xfade.width, xfade.height);
        xctx.globalCompositeOperation = 'source-over';

        if (raw < 1) {
          requestAnimationFrame(revealFrame);
        } else {
          xfade.style.opacity = '0';
          frozenBitmap.close();
        }
      }

      requestAnimationFrame(revealFrame);

    } catch {
      hideUpgradeRing();
      upgrading = false;
      setQualityIndicator('100k', false);
    }
  }

  // Wire up resolution toggle
  if (hasUrls && Object.keys(spzUrls).length > 1) {
    resToggle.style.display = 'flex';
    resToggle.querySelectorAll('.res-btn').forEach(btn => {
      const res = btn.dataset.res;
      if (!spzUrls[res]) { btn.style.display = 'none'; return; }
      btn.addEventListener('click', () => {
        if (currentQuality === res) return;
        upgrading = false;
        
        const cur = new URL(window.location.href);
        cur.searchParams.set('url', spzUrls[res]);
        cur.searchParams.set('active_res', res);
        cur.searchParams.set('_t', Date.now().toString());
        
        if (world && isFirstLoad === false) {
          cur.searchParams.set('cpx', camera.position.x);
          cur.searchParams.set('cpy', camera.position.y);
          cur.searchParams.set('cpz', camera.position.z);
          cur.searchParams.set('cqx', camera.quaternion.x);
          cur.searchParams.set('cqy', camera.quaternion.y);
          cur.searchParams.set('cqz', camera.quaternion.z);
          cur.searchParams.set('cqw', camera.quaternion.w);
          cur.searchParams.set('wqx', world.quaternion.x);
          cur.searchParams.set('wqy', world.quaternion.y);
          cur.searchParams.set('wqz', world.quaternion.z);
          cur.searchParams.set('wqw', world.quaternion.w);
        }
        
        showLoader('Loading ' + res + '\u2026');
        window.location.replace(cur.href);
      });
    });
  }

  await loadSplat(defaultUrl, defaultQuality);
}
</script>
</body>
</html>`;

// ── Experimental viewer HTML (Marble-style loading effect via Dyno shaders) ───
const VIEWER_HTML_EXPERIMENTAL = /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #050508; }
    #canvas { width: 100%; height: 100%; display: block; }
    #loader {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: #050508;
      color: rgba(255,255,255,0.55); font-family: system-ui, sans-serif; gap: 18px;
      transition: opacity 0.5s ease; z-index: 10;
    }
    #loader.hidden { opacity: 0; pointer-events: none; }
    #pcanvas { display: block; }
    #progress-track { width: 180px; height: 2px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
    #progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4ade80, #84cc16); transition: width 0.15s; }
    #label { font-size: 12px; letter-spacing: 0.06em; opacity: 0.7; }
    #error-msg {
      position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
      background: #050508; color: #f87171; font-family: system-ui, sans-serif; font-size: 13px;
      text-align: center; padding: 32px; line-height: 1.6; z-index: 20;
    }
    #drag-hint {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      pointer-events: none; transition: opacity 1s ease; z-index: 5;
    }
    #drag-hint.hidden { opacity: 0; }
    .drag-arrows { display: flex; align-items: center; gap: 22px; }
    .drag-hand-svg {
      width: 58px; height: 58px; color: rgba(132,204,22,0.85);
      filter: drop-shadow(0 0 14px rgba(132,204,22,0.45));
      animation: drag-sway 2.2s ease-in-out infinite alternate;
    }
    @keyframes drag-sway {
      0%   { transform: translateX(-12px) rotate(-7deg); }
      100% { transform: translateX(12px) rotate(7deg); }
    }
    .drag-arr-left  { animation: arr-left-pulse  2.2s ease-in-out infinite alternate; }
    .drag-arr-right { animation: arr-right-pulse 2.2s ease-in-out infinite alternate; }
    @keyframes arr-left-pulse {
      0%   { opacity: 0.65; transform: translateX(-3px); }
      100% { opacity: 0.1;  transform: translateX(3px); }
    }
    @keyframes arr-right-pulse {
      0%   { opacity: 0.1;  transform: translateX(-3px); }
      100% { opacity: 0.65; transform: translateX(3px); }
    }
    .drag-label {
      font-family: system-ui, sans-serif; font-size: 11px; letter-spacing: 0.1em;
      text-transform: uppercase; color: rgba(255,255,255,0.28);
    }
    #res-toggle {
      position: absolute; top: 12px; right: 12px; display: flex; gap: 4px;
      background: rgba(0,0,0,0.5); border-radius: 6px; padding: 3px; z-index: 8;
    }
    .res-btn {
      padding: 3px 8px; border-radius: 4px; border: none; background: transparent;
      color: rgba(255,255,255,0.4); font-size: 10px; cursor: pointer; font-family: system-ui;
      transition: all 0.15s;
    }
    .res-btn:hover { color: rgba(255,255,255,0.8); }
    .res-btn.active { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.9); }
  </style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="loader">
  <canvas id="pcanvas" width="160" height="160"></canvas>
  <div id="label">Loading world\\u2026</div>
  <div id="progress-track"><div id="progress-fill"></div></div>
</div>
<div id="error-msg"></div>
<div id="drag-hint">
  <div class="drag-arrows">
    <svg class="drag-arr-left" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(132,204,22,0.5)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    <svg class="drag-hand-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/>
      <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
      <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    </svg>
    <svg class="drag-arr-right" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(132,204,22,0.5)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </div>
  <span class="drag-label">drag to explore</span>
</div>
<div id="res-toggle" style="display:none">
  <button class="res-btn" data-res="100k">100k</button>
  <button class="res-btn active" data-res="500k">500k</button>
  <button class="res-btn" data-res="full_res">Full</button>
</div>
<div id="quality-badge" style="
  position:absolute; bottom:14px; left:14px;
  background: rgba(0,0,0,0.5); border-radius: 4px;
  padding: 2px 7px; font-size: 10px; font-family: system-ui;
  color: rgba(255,255,255,0.45); display: none; letter-spacing: 0.04em;
  z-index: 8;
"></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.178.0/three.module.js",
    "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/0.1.10/spark.module.js"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
import * as Spark from '@sparkjsdev/spark';

const { SparkRenderer, SplatMesh, SplatLoader, SparkControls } = Spark;
const { dynoFloat, dynoBlock, dynoVec3, dynoBool, Dyno, Gsplat } = Spark.dyno || {};

// ── Parse assets ──────────────────────────────────────────────────────────────
const params  = new URLSearchParams(location.search);
const loader  = document.getElementById('loader');
const progressFill = document.getElementById('progress-fill');
const label   = document.getElementById('label');
const errorMsg = document.getElementById('error-msg');
const dragHint = document.getElementById('drag-hint');
const resToggle = document.getElementById('res-toggle');
function hideDragHint() { dragHint.classList.add('hidden'); }

let assetsData = null;
try {
  const ap = params.get('assets');
  assetsData = ap ? JSON.parse(decodeURIComponent(ap)) : null;
} catch {}

const spzUrls = assetsData?.splats?.spz_urls || {};
const hasUrls = Object.keys(spzUrls).length > 0;

// Determine low-res and high-res URLs for progressive loading
const forcedUrl = params.get('url');
const lowUrl  = forcedUrl ? null : (spzUrls['100k'] || spzUrls['150k'] || null);
const highUrl = forcedUrl ? null : (spzUrls['500k'] || spzUrls['full_res'] || null);
const singleUrl = forcedUrl || lowUrl || highUrl;
const activeResParam = params.get('active_res');

// ── Loader sphere animation ──────────────────────────────────────────────────
const pcanvas = document.getElementById('pcanvas');
const pctx = pcanvas.getContext('2d');
const N = 90;
const pts = Array.from({length: N}, (_, i) => {
  const phi = Math.acos(1 - 2*(i+0.5)/N);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return { basePhi: phi, baseTheta: theta, speed: 0.0004 + (i % 7) * 0.00008 };
});
let pAnimId = null, pTime = 0;
function animateParticles() {
  pTime++;
  pctx.clearRect(0, 0, 160, 160);
  const cx = 80, cy = 80, r = 58;
  const sorted = pts.map(p => {
    const t = p.baseTheta + pTime * p.speed;
    return { x: Math.sin(p.basePhi)*Math.cos(t), y: Math.cos(p.basePhi), z: Math.sin(p.basePhi)*Math.sin(t) };
  }).sort((a,b) => a.z - b.z);
  for (const p of sorted) {
    const depth = (p.z+1)/2, alpha = 0.12+depth*0.82, sz = 0.8+depth*2.4;
    pctx.beginPath(); pctx.arc(cx+p.x*r, cy+p.y*r, sz, 0, Math.PI*2);
    pctx.fillStyle = 'rgba(132,204,22,'+alpha.toFixed(2)+')'; pctx.fill();
  }
  pAnimId = requestAnimationFrame(animateParticles);
}
function startParticleAnim() { if (!pAnimId) animateParticles(); }
function stopParticleAnim()  { if (pAnimId) { cancelAnimationFrame(pAnimId); pAnimId = null; } }

// ── Loader helpers ────────────────────────────────────────────────────────────
function showLoader(msg) {
  progressFill.style.width = '0%';
  label.textContent = msg || 'Loading world\\u2026';
  loader.classList.remove('hidden');
  startParticleAnim();
}
function hideLoader() { loader.classList.add('hidden'); stopParticleAnim(); }
function setProgress(pct) { progressFill.style.width = pct + '%'; }
function showError(msg) { errorMsg.style.display = 'flex'; errorMsg.textContent = msg; }

function setQualityIndicator(quality, upgrading) {
  const badge = document.getElementById('quality-badge');
  if (!badge) return;
  badge.style.display = 'block';
  badge.textContent = upgrading ? quality + ' \\u00b7 upgrading\\u2026' : quality;
  badge.style.color = upgrading ? 'rgba(132,204,22,0.6)' : 'rgba(255,255,255,0.35)';
}
function updateResButtons(quality) {
  resToggle.querySelectorAll('.res-btn').forEach(b => b.classList.toggle('active', b.dataset.res === quality));
}

startParticleAnim();

// ── Check Dyno API availability ──────────────────────────────────────────────
const hasDyno = typeof dynoFloat === 'function'
             && typeof dynoBlock === 'function'
             && typeof Dyno === 'function'
             && Gsplat != null;

if (!hasDyno) console.warn('[marble-studio] SparkJS Dyno API not available; falling back to basic viewer.');

// ══════════════════════════════════════════════════════════════════════════════
// Marble-style point-wave shader modifier (Dyno system)
// Shrinks Gaussian splats to animated dots with jitter, pulse, and sparsity.
// ══════════════════════════════════════════════════════════════════════════════
const PW_DEFAULTS = {
  pointSize: 0.005, pointSizeVariation: 0.01,
  pulseSpeed: 2.2, pulseAmount: 0.4, pulsePhaseVariation: 0.8,
  sparsity: 0.15, jitterAmount: 0.01, jitterSpeed: 1.1,
  colorShift: 0, monochromeAmount: 0, glowIntensity: 1.2,
  opacity: 1, enabled: 1,
};
const TRANSITION_MS = 3000;
const MAX_RADIUS    = 2000;
const RING_COLOR    = [0.627, 0.682, 0.961]; // soft lavender-blue
const RING_WIDTH    = 2.0;
const REVEAL_CENTER = [0, 0, 0];

function cubicEaseInOut(t) {
  return t < 0.5 ? 4*t*t*t : 1 - (-2*t + 2) ** 3 / 2;
}

function createPointWaveModifier(cfg) {
  const timeU       = dynoFloat(0);
  const pointSizeU  = dynoFloat(cfg.pointSize);
  const pointSizeVU = dynoFloat(cfg.pointSizeVariation);
  const pulseSpdU   = dynoFloat(cfg.pulseSpeed);
  const pulseAmtU   = dynoFloat(cfg.pulseAmount);
  const pulsePVU    = dynoFloat(cfg.pulsePhaseVariation);
  const sparsityU   = dynoFloat(cfg.sparsity);
  const jitterAmtU  = dynoFloat(cfg.jitterAmount);
  const jitterSpdU  = dynoFloat(cfg.jitterSpeed);
  const colorShiftU = dynoFloat(cfg.colorShift);
  const monoAmtU    = dynoFloat(cfg.monochromeAmount);
  const glowU       = dynoFloat(cfg.glowIntensity);
  const opacityU    = dynoFloat(cfg.opacity);
  const enabledU    = dynoFloat(cfg.enabled);

  const modifier = dynoBlock(
    { gsplat: Gsplat },
    { gsplat: Gsplat },
    ({ gsplat }) => {
      gsplat = new Dyno({
        inTypes: {
          gsplat: Gsplat,
          time: 'float', pointSize: 'float', pointSizeVariation: 'float',
          pulseSpeed: 'float', pulseAmount: 'float', pulsePhaseVariation: 'float',
          sparsity: 'float', jitterAmount: 'float', jitterSpeed: 'float',
          colorShift: 'float', monochromeAmount: 'float', glowIntensity: 'float',
          opacity: 'float', enabled: 'float',
        },
        outTypes: { gsplat: Gsplat },
        globals: () => [
          [
            'float hash(float n) { return fract(sin(n) * 43758.5453123); }',
            'vec3 hash3v(float n) { return fract(sin(vec3(n, n+1.0, n+2.0)) * vec3(43758.5453123, 22578.1459123, 19642.3490423)); }',
            'vec3 smoothJitter(vec3 pos, float time, float amount, float speed, float seed) {',
            '  float t = time * speed;',
            '  vec3 offset = vec3(sin(pos.y*2.0+t+seed*6.28), sin(pos.z*2.0+t*0.8+seed*3.14), sin(pos.x*2.0+t*1.1+seed*1.57));',
            '  offset += vec3(sin(pos.z*3.0+t*1.3)*0.5, sin(pos.x*3.0+t*1.5)*0.5, sin(pos.y*3.0+t*1.7)*0.5);',
            '  return offset * amount;',
            '}',
            'float pulseValue(float time, float speed, float phase, float amount) {',
            '  return 1.0 + sin(time*speed+phase)*amount;',
            '}',
            'vec3 makePointScale(float baseSize, float sizeVar, float pulse) {',
            '  return vec3(baseSize * (1.0+sizeVar) * pulse);',
            '}',
            'vec3 pointColor(vec3 c, float mono, float shift, float glow) {',
            '  float luma = dot(c, vec3(0.299,0.587,0.114));',
            '  vec3 gray = vec3(luma);',
            '  vec3 tinted = gray + vec3(shift*0.1, shift*0.05, shift*0.15);',
            '  return mix(c, tinted, mono) * glow;',
            '}',
            'float sparsityMask(float h, float s) { return h > s ? 1.0 : 0.0; }',
          ].join('\\n'),
        ],
        statements: ({ inputs: i, outputs: o }) => [
          o.gsplat + ' = ' + i.gsplat + ';',
          'float indexF = float(' + i.gsplat + '.index);',
          'float hash1 = hash(indexF);',
          'float hash2 = hash(indexF * 2.0);',
          'float hash3 = hash(indexF * 3.0);',
          'vec3 hash3vec = hash3v(indexF);',
          'float sparse = sparsityMask(hash1, ' + i.sparsity + ');',
          'float effectStrength = ' + i.enabled + ' * sparse;',
          'vec3 jitter = smoothJitter(' + i.gsplat + '.center, ' + i.time + ', ' + i.jitterAmount + ', ' + i.jitterSpeed + ', hash1);',
          o.gsplat + '.center = mix(' + i.gsplat + '.center, ' + i.gsplat + '.center + jitter, effectStrength);',
          'float phase = hash2 * 6.28318 * ' + i.pulsePhaseVariation + ';',
          'float pulse = pulseValue(' + i.time + ', ' + i.pulseSpeed + ', phase, ' + i.pulseAmount + ');',
          'vec3 pointScale = makePointScale(' + i.pointSize + ', hash3 * ' + i.pointSizeVariation + ', pulse);',
          o.gsplat + '.scales = mix(' + i.gsplat + '.scales, pointScale, effectStrength);',
          'vec3 newColor = pointColor(' + i.gsplat + '.rgba.rgb, ' + i.monochromeAmount + ', ' + i.colorShift + ' * hash3vec.x, ' + i.glowIntensity + ');',
          o.gsplat + '.rgba.rgb = mix(' + i.gsplat + '.rgba.rgb, newColor, effectStrength);',
          'float targetOpacity = ' + i.gsplat + '.rgba.a * ' + i.opacity + ' * sparse;',
          o.gsplat + '.rgba.a = mix(' + i.gsplat + '.rgba.a, targetOpacity, ' + i.enabled + ');',
        ],
      }).apply({
        gsplat, time: timeU, pointSize: pointSizeU, pointSizeVariation: pointSizeVU,
        pulseSpeed: pulseSpdU, pulseAmount: pulseAmtU, pulsePhaseVariation: pulsePVU,
        sparsity: sparsityU, jitterAmount: jitterAmtU, jitterSpeed: jitterSpdU,
        colorShift: colorShiftU, monochromeAmount: monoAmtU, glowIntensity: glowU,
        opacity: opacityU, enabled: enabledU,
      }).gsplat;
      return { gsplat };
    },
  );
  return { modifier, timeUniform: timeU };
}

// ══════════════════════════════════════════════════════════════════════════════
// Reveal mask modifier — growing radius shows high-res inside, dots outside,
// with ring highlight at the boundary (matches Marble's ms() function).
// ══════════════════════════════════════════════════════════════════════════════
function createRevealMask(centerVec, radiusDyno, ringColorVec, ringWidthVal, isHighRes) {
  const centerU    = dynoVec3(centerVec);
  const ringColorU = dynoVec3(ringColorVec);
  const ringWidthU = dynoFloat(ringWidthVal);
  const isHighResU = dynoBool(isHighRes);

  return dynoBlock(
    { gsplat: Gsplat },
    { gsplat: Gsplat },
    ({ gsplat }) => {
      gsplat = new Dyno({
        inTypes: {
          gsplat: Gsplat,
          transitionCenter: 'vec3', transitionRadius: 'float',
          ringColor: 'vec3', ringWidth: 'float', isHighRes: 'bool',
        },
        outTypes: { gsplat: Gsplat },
        statements: ({ inputs: i, outputs: o }) => [
          o.gsplat + ' = ' + i.gsplat + ';',
          'float dist = length(' + o.gsplat + '.center - ' + i.transitionCenter + ');',
          'float revealOpacity;',
          'if (' + i.isHighRes + ') { revealOpacity = dist <= ' + i.transitionRadius + ' ? 1.0 : 0.0; }',
          'else { revealOpacity = dist > ' + i.transitionRadius + ' ? 1.0 : 0.0; }',
          'float ringDist = abs(dist - ' + i.transitionRadius + ');',
          'float safeRW = max(' + i.ringWidth + ', 0.001);',
          'float ringFactor = 1.0 - smoothstep(0.0, safeRW, ringDist);',
          o.gsplat + '.rgba.rgb = mix(' + o.gsplat + '.rgba.rgb, ' + i.ringColor + ', ringFactor * 0.8);',
          o.gsplat + '.rgba.a *= revealOpacity;',
        ],
      }).apply({
        gsplat, transitionCenter: centerU, transitionRadius: radiusDyno,
        ringColor: ringColorU, ringWidth: ringWidthU, isHighRes: isHighResU,
      }).gsplat;
      return { gsplat };
    },
  );
}

if (!singleUrl) {
  hideLoader();
  showError('No world URL provided');
} else {
  // ── Scene setup ─────────────────────────────────────────────────────────────
  const canvas = document.getElementById('canvas');
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, 1, 0.01, 1000);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const spark = new SparkRenderer({ renderer, view: { sort32: true, sort360: true } });
  scene.add(spark);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  function resize() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
    const h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  const controls = new SparkControls({ canvas });
  controls.pointerControls.reverseRotate = true;
  controls.pointerControls.slideSpeed = 0.5;
  controls.pointerControls.scrollSpeed = 0.3;

  canvas.addEventListener('pointerdown', hideDragHint, { once: true });
  setTimeout(hideDragHint, 7000);

  // ── State ───────────────────────────────────────────────────────────────────
  let lowMesh = null, highMesh = null;
  let currentQuality = null;
  let elapsedTime = 0, lastFrameTime = 0;

  // Transition state
  let transitionReady = false;   // both meshes loaded, transition can begin
  let transitionDone  = false;
  let transitionStartTime = null;
  let progress = 0;              // eased 0→1

  // Dyno state (only created if hasDyno)
  let pointWaveBlock = null, timeUniform = null;
  let radiusUniform  = null;
  let lowRevealBlock = null, highRevealBlock = null, lowChainedBlock = null;

  if (hasDyno) {
    const pw = createPointWaveModifier(PW_DEFAULTS);
    pointWaveBlock = pw.modifier;
    timeUniform    = pw.timeUniform;

    radiusUniform  = dynoFloat(0);
    lowRevealBlock  = createRevealMask(REVEAL_CENTER, radiusUniform, RING_COLOR, RING_WIDTH, false);
    highRevealBlock = createRevealMask(REVEAL_CENTER, radiusUniform, RING_COLOR, RING_WIDTH, true);

    // Chain: pointWave → revealMask(isHighRes=false) for low-res during transition
    lowChainedBlock = dynoBlock(
      { gsplat: Gsplat },
      { gsplat: Gsplat },
      ({ gsplat }) => {
        const pw = pointWaveBlock.apply({ gsplat }).gsplat;
        return { gsplat: lowRevealBlock.apply({ gsplat: pw }).gsplat };
      },
    );
  }

  // ── Animation loop ──────────────────────────────────────────────────────────
  renderer.setAnimationLoop((now) => {
    const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;
    elapsedTime += dt;

    // Drive point-wave time uniform
    if (timeUniform) timeUniform.value = elapsedTime;

    // Progressive transition: expanding radius reveal (3s cubic ease in/out)
    if (transitionReady && !transitionDone) {
      if (transitionStartTime === null) transitionStartTime = now;
      const raw = Math.min(1, (now - transitionStartTime) / TRANSITION_MS);
      const eased = cubicEaseInOut(raw);
      progress = eased;

      if (radiusUniform) radiusUniform.value = eased ** 1.5 * MAX_RADIUS;

      if (lowMesh)  lowMesh.needsUpdate = true;
      if (highMesh) highMesh.needsUpdate = true;

      if (raw >= 1) {
        transitionDone = true;
        progress = 1;
        // Clean up: pristine high-res, hide low-res
        if (highMesh) {
          highMesh.worldModifier = undefined;
          highMesh.updateGenerator();
          highMesh.updateVersion();
        }
        if (lowMesh) lowMesh.visible = false;
        setQualityIndicator(currentQuality, false);
      }
    }

    // Visibility during transition
    if (lowMesh)  lowMesh.visible  = progress < 1;
    if (highMesh) highMesh.visible = progress > 0 || transitionDone;

    if (lowMesh || highMesh) controls.update(camera);
    renderer.render(scene, camera);
  });

  // ── Load splats progressively ───────────────────────────────────────────────
  const canProgressiveLoad = hasDyno && lowUrl && highUrl && lowUrl !== highUrl;

  if (canProgressiveLoad) {
    // === Progressive path: low-res with dot effect → transition → high-res ===
    showLoader('Loading world\\u2026');

    // Start loading both in parallel
    const lowLoader  = new SplatLoader();
    const highLoader = new SplatLoader();
    const lowPromise  = lowLoader.loadAsync(lowUrl, (evt) => {
      if (evt.total > 0) setProgress(Math.round((evt.loaded / evt.total) * 80));
    });
    const highPromise = highLoader.loadAsync(highUrl);

    try {
      // Low-res finishes first (smaller) — show dots immediately
      const lowPacked = await lowPromise;
      lowMesh = new SplatMesh({ packedSplats: lowPacked });
      lowMesh.quaternion.set(1, 0, 0, 0);

      // Apply point-wave modifier: splats become oscillating dots
      lowMesh.worldModifier = pointWaveBlock;
      lowMesh.updateGenerator();
      lowMesh.updateVersion();

      scene.add(lowMesh);
      camera.position.set(0, 0, 0);
      camera.quaternion.set(0, 0, 0, 1);
      currentQuality = '100k';
      setQualityIndicator('100k', true);
      hideLoader();
      updateResButtons('100k');

      // Now wait for high-res
      const highPacked = await highPromise;
      setProgress(100);

      highMesh = new SplatMesh({ packedSplats: highPacked });
      highMesh.quaternion.set(1, 0, 0, 0);
      highMesh.visible = false; // hidden until transition starts

      // Apply reveal mask to high-res (visible inside growing radius)
      highMesh.worldModifier = highRevealBlock;
      highMesh.updateGenerator();
      highMesh.updateVersion();
      scene.add(highMesh);

      // Switch low-res to chained modifier (pointWave + reveal mask outside radius)
      lowMesh.worldModifier = lowChainedBlock;
      lowMesh.updateGenerator();
      lowMesh.updateVersion();

      // Start the transition
      currentQuality = '500k';
      transitionReady = true;

    } catch (err) {
      hideLoader();
      showError('Failed to load world: ' + (err.message || err));
      console.error(err);
    }

  } else {
    // === Fallback: single-URL load (no Dyno, or only one resolution) =========
    const url = singleUrl;
    const quality = activeResParam || (lowUrl ? '100k' : (highUrl ? '500k' : 'unknown'));
    showLoader('Loading world\u2026');

    try {
      const splatLoader = new SplatLoader();
      const packed = await splatLoader.loadAsync(url, (evt) => {
        if (evt.total > 0) setProgress(Math.round((evt.loaded / evt.total) * 100));
      });
      const mesh = new SplatMesh({ packedSplats: packed });
      
      const safeFloat = (val, fb) => { const p = parseFloat(val); return isNaN(p) ? fb : p; };
      const hasPos = params.has('cpx') && !isNaN(parseFloat(params.get('cpx')));
      
      if (hasPos) {
        mesh.quaternion.set(
          safeFloat(params.get('wqx'), 1), safeFloat(params.get('wqy'), 0),
          safeFloat(params.get('wqz'), 0), safeFloat(params.get('wqw'), 0)
        );
      } else {
        mesh.quaternion.set(1, 0, 0, 0);
      }
      
      scene.add(mesh);
      highMesh = mesh; // We assign to highMesh so the progress=1 animation loop doesn't hide it

      if (hasPos) {
        camera.position.set(
          safeFloat(params.get('cpx'), 0), safeFloat(params.get('cpy'), 0), safeFloat(params.get('cpz'), 0)
        );
        camera.quaternion.set(
          safeFloat(params.get('cqx'), 0), safeFloat(params.get('cqy'), 0), safeFloat(params.get('cqz'), 0), safeFloat(params.get('cqw'), 1)
        );
      } else {
        camera.position.set(0, 0, 0);
        camera.quaternion.set(0, 0, 0, 1);
      }

      // If Dyno is available, show dot effect briefly before revealing
      if (hasDyno && pointWaveBlock && !hasPos) {
        mesh.worldModifier = pointWaveBlock;
        mesh.updateGenerator();
        mesh.updateVersion();
        hideLoader();

        // After 2s, remove modifier to reveal the full mesh
        setTimeout(() => {
          mesh.worldModifier = undefined;
          mesh.updateGenerator();
          mesh.updateVersion();
        }, 2000);
      } else {
        hideLoader();
      }

      currentQuality = quality;
      transitionDone = true;
      progress = 1;
      setQualityIndicator(quality, false);
      updateResButtons(quality);

    } catch (err) {
      hideLoader();
      showError('Failed to load world: ' + (err.message || err));
      console.error(err);
    }
  }

  // ── Resolution toggle (manual switch) ───────────────────────────────────────
  if (hasUrls && Object.keys(spzUrls).length > 1) {
    resToggle.style.display = 'flex';
    resToggle.querySelectorAll('.res-btn').forEach(btn => {
      const res = btn.dataset.res;
      if (!spzUrls[res]) { btn.style.display = 'none'; return; }
      
      if (activeResParam === res || (!activeResParam && currentQuality === res)) {
        resToggle.querySelectorAll('.res-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('active') || currentQuality === res) return;
        
        const cur = new URL(window.location.href);
        cur.searchParams.set('url', spzUrls[res]);
        cur.searchParams.set('active_res', res);
        cur.searchParams.set('_t', Date.now().toString());
        
        const activeMesh = lowMesh || highMesh;
        if (activeMesh && camera) {
          cur.searchParams.set('cpx', camera.position.x);
          cur.searchParams.set('cpy', camera.position.y);
          cur.searchParams.set('cpz', camera.position.z);
          cur.searchParams.set('cqx', camera.quaternion.x);
          cur.searchParams.set('cqy', camera.quaternion.y);
          cur.searchParams.set('cqz', camera.quaternion.z);
          cur.searchParams.set('cqw', camera.quaternion.w);
          cur.searchParams.set('wqx', activeMesh.quaternion.x);
          cur.searchParams.set('wqy', activeMesh.quaternion.y);
          cur.searchParams.set('wqz', activeMesh.quaternion.z);
          cur.searchParams.set('wqw', activeMesh.quaternion.w);
        }
        
        showLoader('Loading ' + res + '\u2026');
        window.location.replace(cur.href);
      });
    });
  }
}
</script>
</body>
</html>`;

export function createRouter(db: InstanceType<typeof Database>) {
    const router = Router();

    ensureSettingsTable(db);

    // ── API key settings ──────────────────────────────────────────────────────
    router.get('/api/marble-studio/settings', (_req, res) => {
        const key = getApiKey(db);
        res.json({
            hasKey: !!key,
            keyHint: key ? keyHint(key) : null,
        });
    });

    router.put('/api/marble-studio/settings', (req, res) => {
        const { apiKey: newKey } = req.body as { apiKey?: string };
        if (!newKey?.trim()) return res.status(400).json({ error: 'apiKey required' });
        const encKey = getOrCreateEncKey(db);
        const encrypted = encryptValue(newKey.trim(), encKey);
        db.prepare('INSERT OR REPLACE INTO marble_studio_settings (key, value) VALUES (?, ?)').run('api_key', encrypted);
        res.json({ ok: true, keyHint: keyHint(newKey.trim()) });
    });

    router.delete('/api/marble-studio/settings', (_req, res) => {
        db.prepare('DELETE FROM marble_studio_settings WHERE key=?').run('api_key');
        res.json({ ok: true });
    });

    // ── List worlds ───────────────────────────────────────────────────────────
    router.get('/api/marble-studio/worlds', (_req, res) => {
        const worlds = db.prepare(
            'SELECT * FROM marble_worlds ORDER BY created_at DESC'
        ).all();
        res.json(worlds);
    });

    // ── Get single world ──────────────────────────────────────────────────────
    router.get('/api/marble-studio/worlds/:id', (req, res) => {
        const world = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(req.params.id) as MarbleWorld | undefined;
        if (!world) return res.status(404).json({ error: 'Not found' });
        res.json(world);
    });

    // ── Prepare media asset upload ─────────────────────────────────────────────
    router.post('/api/marble-studio/media-assets/prepare-upload', async (req, res) => {
        const key = getApiKey(db);
        if (!key) return res.status(503).json({ error: 'No World Labs API key configured.' });
        const { file_name, kind, extension } = req.body as { file_name?: string; kind?: string; extension?: string };
        if (!file_name || !kind) return res.status(400).json({ error: 'file_name and kind required' });
        try {
            const r = await fetch(`${WORLDLABS_API}/media-assets:prepare_upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'WLT-Api-Key': key },
                body: JSON.stringify({ file_name, kind, extension: extension || file_name.split('.').pop() }),
            });
            const data = await r.json();
            if (!r.ok) return res.status(502).json(data);
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e instanceof Error ? e.message : 'Request failed' });
        }
    });

    // ── Generate new world ────────────────────────────────────────────────────
    router.post('/api/marble-studio/worlds', async (req, res) => {
        const key = getApiKey(db);
        if (!key) {
            return res.status(503).json({
                error: 'No World Labs API key configured. Add one in Marble Studio settings.',
            });
        }

        const {
            name,
            prompt = '',
            model = 'marble-1.1',
            prompt_type = 'text',
            // image mode
            image_url,
            image_media_asset_id,
            is_pano,
            // multi-image mode
            images,
            // video mode
            video_url,
            video_media_asset_id,
        } = req.body as {
            name: string;
            prompt?: string;
            model?: string;
            prompt_type?: string;
            image_url?: string;
            image_media_asset_id?: string;
            is_pano?: boolean;
            images?: { url?: string; media_asset_id?: string; azimuth?: number }[];
            video_url?: string;
            video_media_asset_id?: string;
        };

        if (!name?.trim()) return res.status(400).json({ error: 'name required' });

        // Build world_prompt and determine what to store in DB
        let worldPrompt: object;
        let dbPrompt: string;

        switch (prompt_type) {
            case 'image': {
                const hasUri = image_url?.trim();
                const hasAsset = image_media_asset_id?.trim();
                if (!hasUri && !hasAsset) {
                    return res.status(400).json({ error: 'image_url or image_media_asset_id required' });
                }
                const imgContent = hasAsset
                    ? { source: 'media_asset', media_asset_id: hasAsset }
                    : { source: 'uri', uri: image_url!.trim() };
                worldPrompt = {
                    type: 'image',
                    image_prompt: { ...imgContent, ...(is_pano ? { is_pano: true } : {}) },
                    ...(prompt?.trim() ? { text_prompt: prompt.trim() } : {}),
                };
                dbPrompt = prompt?.trim() || image_url?.trim() || 'image';
                break;
            }
            case 'multi-image': {
                if (!images?.length) {
                    return res.status(400).json({ error: 'images array required' });
                }
                const validImages = images.filter(img => img.url?.trim() || img.media_asset_id?.trim());
                if (!validImages.length) {
                    return res.status(400).json({ error: 'at least one valid image required' });
                }
                worldPrompt = {
                    type: 'multi-image',
                    multi_image_prompt: validImages.map(img => ({
                        azimuth: img.azimuth ?? 0,
                        content: img.media_asset_id?.trim()
                            ? { source: 'media_asset', media_asset_id: img.media_asset_id.trim() }
                            : { source: 'uri', uri: img.url!.trim() },
                    })),
                    ...(prompt?.trim() ? { text_prompt: prompt.trim() } : {}),
                };
                dbPrompt = prompt?.trim() || `${validImages.length} reference image${validImages.length !== 1 ? 's' : ''}`;
                break;
            }
            case 'video': {
                const hasVUri = video_url?.trim();
                const hasVAsset = video_media_asset_id?.trim();
                if (!hasVUri && !hasVAsset) {
                    return res.status(400).json({ error: 'video_url or video_media_asset_id required' });
                }
                worldPrompt = {
                    type: 'video',
                    video_prompt: hasVAsset
                        ? { source: 'media_asset', media_asset_id: hasVAsset }
                        : { source: 'uri', uri: video_url!.trim() },
                    ...(prompt?.trim() ? { text_prompt: prompt.trim() } : {}),
                };
                dbPrompt = prompt?.trim() || video_url?.trim() || 'video';
                break;
            }
            default: { // text
                if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
                worldPrompt = { type: 'text', text_prompt: prompt.trim() };
                dbPrompt = prompt.trim();
            }
        }

        // Insert pending record
        const r = db.prepare(
            `INSERT INTO marble_worlds (name, prompt, prompt_type, model, status) VALUES (?, ?, ?, ?, 'pending')`
        ).run(name.trim(), dbPrompt, prompt_type, model);
        const rowId = r.lastInsertRowid;

        // Call WorldLabs API
        try {
            const genRes = await fetch(`${WORLDLABS_API}/worlds:generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'WLT-Api-Key': key,
                },
                body: JSON.stringify({
                    display_name: name.trim(),
                    model,
                    world_prompt: worldPrompt,
                }),
            });

            if (!genRes.ok) {
                const errText = await genRes.text();
                db.prepare('UPDATE marble_worlds SET status=?, error_msg=? WHERE id=?')
                    .run('error', `WorldLabs API error (${genRes.status}): ${errText}`, rowId);
                const world = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(rowId);
                return res.status(502).json(world);
            }

            const genData = await genRes.json() as Record<string, unknown>;
            console.log('[marble-studio] generate response:', JSON.stringify(genData));

            // Operation ID: WorldLabs may use name ("operations/xxx"), operationId, or id
            const rawOpName = String(genData.name || genData.operationId || genData.operation_id || genData.id || '');
            // Strip "operations/" prefix if present; take the last path segment
            const operationId = rawOpName.includes('/')
                ? rawOpName.split('/').pop()!
                : rawOpName;

            db.prepare('UPDATE marble_worlds SET status=?, operation_id=? WHERE id=?')
                .run('generating', operationId, rowId);

            const world = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(rowId);
            return res.status(201).json(world);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            db.prepare('UPDATE marble_worlds SET status=?, error_msg=? WHERE id=?')
                .run('error', msg, rowId);
            const world = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(rowId);
            return res.status(500).json(world);
        }
    });

    // ── Shared: apply a completed WorldLabs op/world payload to a DB row ──────
    function applyWorldData(rowId: number | bigint, wdata: Record<string, unknown>) {
        const assetsData = (wdata.assets || wdata.output || {}) as Record<string, unknown>;
        const assetsJson = JSON.stringify(assetsData);
        const thumbnail = (assetsData.thumbnail_url as string) || null;
        const caption   = (assetsData.caption as string) || null;

        // World ID may come as "worlds/abc123" or bare "abc123"
        const rawId = String(wdata.id || wdata.name || wdata.worldId || wdata.world_id || '');
        const wlId  = rawId ? (rawId.includes('/') ? rawId.split('/').pop()! : rawId) : null;

        db.prepare(`
            UPDATE marble_worlds
            SET status='done', world_id=?, assets_json=?, thumbnail_url=?, caption=?
            WHERE id=?
        `).run(wlId || null, assetsJson, thumbnail, caption, rowId);
    }

    // ── Poll operation status ─────────────────────────────────────────────────
    router.get('/api/marble-studio/worlds/:id/poll', async (req, res) => {
        const key = getApiKey(db);
        const world = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(req.params.id) as MarbleWorld | undefined;
        if (!world) return res.status(404).json({ error: 'Not found' });

        // Nothing to poll if not currently generating
        if (world.status !== 'generating' || !world.operation_id || !key) {
            return res.json(world);
        }

        try {
            const opRes = await fetch(
                `${WORLDLABS_API}/operations/${world.operation_id}`,
                { headers: { 'WLT-Api-Key': key } }
            );

            if (!opRes.ok) {
                console.error(`[marble-studio] poll ${world.operation_id}: HTTP ${opRes.status}`);
                return res.json(world);
            }

            const op = await opRes.json() as Record<string, unknown>;
            console.log(`[marble-studio] poll op/${world.operation_id}:`, JSON.stringify(op));

            // WorldLabs may use Google LRO (done: true) or a status field
            const status  = String(op.status || op.state || '').toUpperCase();
            const isDone  = op.done === true ||
                            status === 'SUCCEEDED' || status === 'DONE' || status === 'COMPLETED';
            const hasError = op.error || op.error_details;

            if (isDone) {
                if (hasError) {
                    const err    = (op.error || op.error_details) as { message?: string } | undefined;
                    const errMsg = err?.message || JSON.stringify(op.error || op.error_details);
                    db.prepare('UPDATE marble_worlds SET status=?, error_msg=? WHERE id=?')
                        .run('error', errMsg, world.id);
                } else {
                    // World data may live in response, metadata, or at the root
                    const wdata = (op.response || op.metadata || op) as Record<string, unknown>;
                    applyWorldData(world.id, wdata);
                }
            }
        } catch (e) {
            console.error('[marble-studio] poll error:', e);
        }

        const updated = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(world.id);
        res.json(updated);
    });

    // ── Sync worlds from WorldLabs (backfill + fix stuck) ────────────────────
    router.post('/api/marble-studio/worlds/sync', async (req, res) => {
        const key = getApiKey(db);
        if (!key) return res.status(503).json({ error: 'No World Labs API key configured.' });

        try {
            const listRes = await fetch(`${WORLDLABS_API}/worlds:list`, {
                method: 'POST',
                headers: { 'WLT-Api-Key': key, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            if (!listRes.ok) {
                const errText = await listRes.text();
                return res.status(502).json({ error: `WorldLabs API error (${listRes.status}): ${errText}` });
            }

            const data = await listRes.json() as Record<string, unknown>;
            console.log('[marble-studio] sync list:', JSON.stringify(data));

            // List response may be { worlds: [...] }, { items: [...] }, or a plain array
            const wlWorlds = (
                Array.isArray(data)         ? data       :
                Array.isArray(data.worlds)  ? data.worlds :
                Array.isArray(data.items)   ? data.items  : []
            ) as Record<string, unknown>[];

            let synced = 0;
            const resultWorlds: MarbleWorld[] = [];

            for (const w of wlWorlds) {
                const rawId = String(w.world_id || w.id || w.name || w.worldId || '');
                if (!rawId) continue;
                const wlId = rawId.includes('/') ? rawId.split('/').pop()! : rawId;

                const assetsData = (w.assets || w.output || {}) as Record<string, unknown>;
                const assetsJson = JSON.stringify(assetsData);
                const thumbnail  = (assetsData.thumbnail_url as string) || null;
                const caption    = (assetsData.caption as string) || null;
                const model      = String(w.model || w.modelId || 'unknown');
                const wStatus    = String(w.status || w.state || '').toUpperCase();
                const rowStatus  = wStatus === 'FAILED' ? 'error' : 'done';

                const promptObj  = (w.worldPrompt || w.world_prompt || {}) as Record<string, unknown>;
                const promptText = String(promptObj.textPrompt || promptObj.text_prompt || '[Imported from WorldLabs]');
                const promptType = String(promptObj.type || 'text');

                const displayName = String(w.displayName || w.display_name || `World ${wlId.slice(0, 8)}`);
                // If displayName looks like a resource path, strip the prefix
                const cleanName = displayName.includes('/') ? displayName.split('/').pop()! : displayName;

                // 1. Already in DB by world_id → skip
                const byId = db.prepare('SELECT id FROM marble_worlds WHERE world_id=?').get(wlId);
                if (byId) continue;

                // 2. Stuck "generating" record with matching name → update
                const stuck = db.prepare(
                    `SELECT id FROM marble_worlds WHERE status='generating' AND name=? LIMIT 1`
                ).get(cleanName) as { id: number } | undefined;

                if (stuck) {
                    db.prepare(`
                        UPDATE marble_worlds
                        SET status=?, world_id=?, assets_json=?, thumbnail_url=?, caption=?
                        WHERE id=?
                    `).run(rowStatus, wlId, assetsJson, thumbnail, caption, stuck.id);
                    const updated = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(stuck.id) as MarbleWorld;
                    resultWorlds.push(updated);
                    synced++;
                    continue;
                }

                // 3. New world — insert
                const ins = db.prepare(`
                    INSERT INTO marble_worlds
                    (name, prompt, prompt_type, model, world_id, status, assets_json, thumbnail_url, caption)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(cleanName, promptText, promptType, model, wlId, rowStatus, assetsJson, thumbnail, caption);

                const inserted = db.prepare('SELECT * FROM marble_worlds WHERE id=?').get(ins.lastInsertRowid) as MarbleWorld;
                resultWorlds.push(inserted);
                synced++;
            }

            res.json({ synced, worlds: resultWorlds });
        } catch (e) {
            res.status(500).json({ error: e instanceof Error ? e.message : 'Sync failed' });
        }
    });

    // ── Delete world ──────────────────────────────────────────────────────────
    router.delete('/api/marble-studio/worlds/:id', (req, res) => {
        const n = db.prepare('DELETE FROM marble_worlds WHERE id=?').run(req.params.id);
        if (n.changes === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    });

    // ── 3D viewer iframe HTML ─────────────────────────────────────────────────
    router.get('/api/marble-studio/viewer', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        
        // backup: always send fancy point wave viewer
        // 
        // const mode = req.query.mode;
        // res.send(mode === 'experimental' ? VIEWER_HTML_EXPERIMENTAL : VIEWER_HTML);
        
        res.send(VIEWER_HTML_EXPERIMENTAL);
    });

    return router;
}
