import React, { useEffect, useRef } from 'react';

// Animated form backgrounds, shared by the public renderer and the editor's theme
// preview. "waves" and "aurora" are pure CSS (spans styled in FormRenderer.css);
// "gradientWave" (WebGL), "gatewayFlow" and "flow" (Canvas 2D) draw on a canvas. All of them take their colours from the
// form's primary / accent / background colour and add no dependencies.

const CSS_SHAPES = { waves: 3, aurora: 3 };

export const BG_ANIMATIONS = ['none', 'waves', 'gradientWave', 'aurora', 'gatewayFlow', 'flow'];

// Forms saved before 0.36 may still carry the retired "bubbles" / "particles" values.
// They show their replacement until the form is saved with a new choice.
const LEGACY_BG_ANIMATIONS = { bubbles: 'gradientWave', particles: 'gatewayFlow' };

export function normalizeBgAnimation(value) {
  const bg = LEGACY_BG_ANIMATIONS[value] || value;
  return BG_ANIMATIONS.includes(bg) ? bg : 'none';
}

// "#6C5CE7" / "#abc" → [108, 92, 231]
function hexToRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export default function AnimatedBackground({ animation, primaryColor, accentColor, backgroundColor }) {
  const bg = normalizeBgAnimation(animation);
  if (bg === 'none') return null;

  if (CSS_SHAPES[bg]) {
    return (
      <div className={`form-bg-animation bg-${bg}`} aria-hidden="true">
        {Array.from({ length: CSS_SHAPES[bg] }, (_, i) => <span key={i} />)}
      </div>
    );
  }

  const colors = {
    primary: hexToRgb(primaryColor, [108, 92, 231]),
    accent: hexToRgb(accentColor, [162, 155, 254]),
    background: hexToRgb(backgroundColor, [255, 255, 255]),
  };

  return (
    <div className={`form-bg-animation bg-${bg}`} aria-hidden="true">
      {bg === 'flow' && <SceneCanvas createScene={createFloatingPathsScene} colors={colors} />}
      {bg === 'gradientWave' && <SceneCanvas createScene={createGradientWaveScene} colors={colors} />}
      {bg === 'gatewayFlow' && <SceneCanvas createScene={createGatewayFlowScene} colors={colors} />}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Flow: two mirrored layers of 36 curved paths whose strokes slowly draw along
   themselves (after bundui's "Floating Paths", which animates SVG paths with
   framer-motion). Drawn on a canvas instead: repainting 72 animated SVG paths
   every frame is far more expensive for the browser than stroking them here.
   --------------------------------------------------------------------------- */

const FLOW_VIEWBOX = { width: 696, height: 316 };
const FLOW_OPACITY = 0.75;

function cubicLength(p0, p1, p2, p3) {
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= 48; i++) {
    const pt = bezierPoint(i / 48, p0, p1, p2, p3);
    length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return length;
}

// The original's path geometry, in its 696×316 viewBox.
function floatingPathLayer(position) {
  return Array.from({ length: 36 }, (_, i) => {
    const o = i * 5 * position;
    const pt = (x, y) => ({ x, y });
    const a = [pt(-(380 - o), -(189 + i * 6)), pt(-(380 - o), -(189 + i * 6)), pt(-(312 - o), 216 - i * 6), pt(152 - o, 343 - i * 6)];
    const b = [a[3], pt(616 - o, 470 - i * 6), pt(684 - o, 875 - i * 6), pt(684 - o, 875 - i * 6)];
    // Deterministic spread of 20–30s durations, each path starting at a different
    // point of its cycle so the layer looks like it has been running all along.
    const duration = 20 + ((i * 37 + (position > 0 ? 3 : 7)) % 11);
    return {
      segments: [a, b],
      length: cubicLength(...a) + cubicLength(...b),
      width: 0.5 + i * 0.03,
      opacity: Math.min(1, 0.1 + i * 0.03),
      duration,
      phase: ((i * 2.3 + (position > 0 ? 0 : 5)) % duration) / duration,
    };
  });
}

const FLOATING_PATHS = [floatingPathLayer(1), floatingPathLayer(-1)];

function createFloatingPathsScene(canvas, colorsRef) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const layers = FLOATING_PATHS.map(paths => paths.map(p => {
    const path = new Path2D();
    const [a, b] = p.segments;
    path.moveTo(a[0].x, a[0].y);
    path.bezierCurveTo(a[1].x, a[1].y, a[2].x, a[2].y, a[3].x, a[3].y);
    path.bezierCurveTo(b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y);
    return { ...p, path };
  }));
  let dpr = 1;
  let width = 1;
  let height = 1;

  return {
    resize(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    frame(time) {
      const { primary, accent } = colorsRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Cover the box with the viewBox, like preserveAspectRatio="xMidYMid slice".
      const scale = Math.max(width / FLOW_VIEWBOX.width, height / FLOW_VIEWBOX.height);
      const offsetX = (width - FLOW_VIEWBOX.width * scale) / 2;
      const offsetY = (height - FLOW_VIEWBOX.height * scale) / 2;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);

      layers.forEach((paths, layer) => {
        ctx.strokeStyle = `rgb(${(layer === 0 ? primary : accent).join(', ')})`;
        for (const p of paths) {
          // Same keyframes as the original: the visible stretch grows 30% → 100% of
          // the path while sliding off its end and back, opacity 0.3 → 0.6 → 0.3.
          const phase = (time / p.duration + p.phase) % 1;
          const swing = 1 - Math.abs(2 * phase - 1);
          ctx.globalAlpha = p.opacity * (0.3 + 0.3 * swing) * FLOW_OPACITY;
          ctx.lineWidth = p.width;
          ctx.setLineDash([(0.3 + 0.7 * phase) * p.length, p.length]);
          ctx.lineDashOffset = -swing * p.length;
          ctx.stroke(p.path);
        }
      });
      ctx.globalAlpha = 1;
    },
  };
}

/* ---------------------------------------------------------------------------
   Canvas driver: creates a canvas sized to its box, runs the scene's frame() on every
   animation frame, and draws a single still frame for prefers-reduced-motion.
   Colours are read through a ref, so picking a colour in the editor doesn't
   rebuild the scene (or, for WebGL, a new context).
   --------------------------------------------------------------------------- */

const STILL_TIME = 12;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function SceneCanvas({ createScene, colors }) {
  const hostRef = useRef(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const sceneRef = useRef(null);
  const colorKey = [colors.primary, colors.accent, colors.background].join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // A fresh canvas per mount: a WebGL scene frees its context on unmount, and a
    // canvas whose context was lost can't get a working one again.
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const scene = createScene(canvas, colorsRef);
    if (!scene) return () => canvas.remove();
    sceneRef.current = scene;
    const still = prefersReducedMotion();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      scene.resize(Math.max(1, rect.width), Math.max(1, rect.height));
      if (still) scene.frame(STILL_TIME, 0);
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    if (!observer) window.addEventListener('resize', resize);

    let raf = 0;
    if (!still) {
      const start = performance.now();
      let last = start;
      const loop = now => {
        // dt is in 60fps frames, capped so a backgrounded tab doesn't jump on return.
        const dt = Math.min((now - last) / (1000 / 60), 3);
        last = now;
        scene.frame((now - start) / 1000, dt);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      scene.destroy?.();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [createScene]);

  // The animated loop picks new colours up on its own; a still frame must be redrawn.
  useEffect(() => {
    if (sceneRef.current && prefersReducedMotion()) sceneRef.current.frame(STILL_TIME, 0);
  }, [colorKey]);

  return <div className="form-bg-canvas" ref={hostRef} />;
}

/* ---------------------------------------------------------------------------
   Gradient Wave: a WebGL fragment shader of simplex-noise colour fields that
   form a soft wave rising from the bottom of the form. Rendered at half
   resolution (it is all soft gradients) and falls back to a CSS gradient
   where WebGL is unavailable.
   --------------------------------------------------------------------------- */

const GRADIENT_WAVE_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const GRADIENT_WAVE_FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBg;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * (uRes.x / uRes.y), uv.y);
  float t = uTime;

  float n1 = snoise(vec3(p.x * 0.7 - t * 0.04, p.y * 1.1, t * 0.05));
  float n2 = snoise(vec3(p.x * 1.4 + 5.0, p.y * 1.9 - t * 0.03, t * 0.08));

  // Colour flowing through the wave: primary → accent across, with a lighter tone
  // drifting through it.
  vec3 col = mix(uC1, uC2, smoothstep(0.0, 1.0, uv.x * 0.8 + n1 * 0.55 + 0.1));
  col = mix(col, uC3, smoothstep(0.1, 0.9, n2 * 0.5 + 0.5) * 0.75);

  // Two crests, the back one higher and fainter, rising from the bottom.
  float crestA = 0.40 - (uv.x - 0.5) * 0.18 + 0.07 * sin(p.x * 2.1 + t * 0.35) + 0.06 * n1;
  float crestB = 0.58 + (uv.x - 0.5) * 0.14 + 0.06 * sin(p.x * 1.6 - t * 0.28 + 1.7) + 0.05 * n2;
  float front = smoothstep(crestA + 0.16, crestA - 0.20, uv.y);
  float back = smoothstep(crestB + 0.20, crestB - 0.22, uv.y) * 0.45;
  float body = max(front, back);

  // Soft sheen along the front crest.
  float ridge = exp(-pow((uv.y - crestA) * 10.0, 2.0));
  col = mix(col, vec3(1.0), ridge * 0.18);

  gl_FragColor = vec4(mix(uBg, col, clamp(body * 0.9 + 0.06, 0.0, 1.0)), 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function createGradientWaveScene(canvas, colorsRef) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    || canvas.getContext('experimental-webgl');
  const vs = gl && compileShader(gl, gl.VERTEX_SHADER, GRADIENT_WAVE_VERTEX);
  const fs = gl && compileShader(gl, gl.FRAGMENT_SHADER, GRADIENT_WAVE_FRAGMENT);
  const program = vs && fs && gl.createProgram();
  if (program) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    // No WebGL: a static gradient in the same colours keeps the look.
    const { primary, accent, background } = colorsRef.current;
    const host = canvas.parentNode;
    host.style.background = `linear-gradient(to top, ${rgbToCss(primary)} 0%, ${rgbToCss(accent)} 35%, ${rgbToCss(background)} 75%)`;
    host.style.opacity = '0.6';
    canvas.style.display = 'none';
    return null;
  }

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(program, name);
  const uRes = u('uRes'), uTime = u('uTime'), uBg = u('uBg'), uC1 = u('uC1'), uC2 = u('uC2'), uC3 = u('uC3');
  const norm = c => c.map(v => v / 255);

  return {
    resize(width, height) {
      canvas.width = Math.max(1, Math.round(width / 2));
      canvas.height = Math.max(1, Math.round(height / 2));
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    frame(time) {
      const { primary, accent, background } = colorsRef.current;
      const light = primary.map(v => v + (255 - v) * 0.55);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform3fv(uBg, norm(background));
      gl.uniform3fv(uC1, norm(primary));
      gl.uniform3fv(uC2, norm(accent));
      gl.uniform3fv(uC3, norm(light));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Browsers cap live WebGL contexts; free this one right away.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/* ---------------------------------------------------------------------------
   Gateway Flow: dotted bezier streams from both edges converging on the centre,
   each carrying a particle (after Meng To's "Gateway Flow"). The original's click
   shockwaves are left out, since respondents click all the time in a form. The
   centre fades out so the streams never run through the question text.
   --------------------------------------------------------------------------- */

function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function createGatewayFlowScene(canvas, colorsRef) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // The dotted streams are thousands of tiny dashes, far too many to stroke every
  // frame. They sit on a cached layer that is redrawn only on resize, a colour
  // change, or (at most once a second) after streams have drifted.
  const lines = document.createElement('canvas');
  const linesCtx = lines.getContext('2d');
  let dpr = 1;
  let width = 1;
  let height = 1;
  let paths = [];
  let linesKey = '';
  let linesDrawnAt = -Infinity;
  let drifted = false;

  function buildPaths(count) {
    paths = Array.from({ length: count }, (_, i) => ({
      isLeft: i % 2 === 0,
      // Start height as a fraction of the box, so a resize keeps the layout.
      start: (i / count) * 1.4 - 0.2,
      t: Math.random(),
      speed: 0.0015 + Math.random() * 0.002,
    }));
  }

  function curve(path) {
    const cx = width / 2;
    const cy = height / 2;
    const y = path.start * height;
    return [
      { x: path.isLeft ? 0 : width, y },
      { x: path.isLeft ? cx * 0.5 : width - cx * 0.5, y },
      { x: path.isLeft ? cx * 0.8 : width - cx * 0.8, y: cy },
      { x: cx, y: cy },
    ];
  }

  // How much of a point survives the centre fade: 10% at the centre, all of it
  // from fadeRadius outwards.
  const fadeRadius = () => Math.min(width, height) * 0.42;
  function visibility(x, y) {
    const d = Math.hypot(x - width / 2, y - height / 2) / fadeRadius();
    return d >= 1 ? 1 : 0.1 + 0.9 * d;
  }

  function drawLines(rgb) {
    linesCtx.setTransform(1, 0, 0, 1, 0, 0);
    linesCtx.clearRect(0, 0, lines.width, lines.height);
    linesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    linesCtx.beginPath();
    for (const path of paths) {
      const [p0, p1, p2, p3] = curve(path);
      linesCtx.moveTo(p0.x, p0.y);
      linesCtx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    }
    linesCtx.strokeStyle = `rgba(${rgb}, 0.45)`;
    linesCtx.lineWidth = 1.2;
    linesCtx.setLineDash([1, 4]);
    linesCtx.stroke();

    const cx = width / 2;
    const cy = height / 2;
    const fade = linesCtx.createRadialGradient(cx, cy, 0, cx, cy, fadeRadius());
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    linesCtx.globalCompositeOperation = 'destination-out';
    linesCtx.fillStyle = fade;
    linesCtx.fillRect(0, 0, width, height);
    linesCtx.globalCompositeOperation = 'source-over';
  }

  return {
    resize(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = w;
      height = h;
      canvas.width = lines.width = Math.round(w * dpr);
      canvas.height = lines.height = Math.round(h * dpr);
      // 80 streams on a full-height page, fewer on a small box such as the editor preview.
      const count = Math.max(24, Math.min(80, Math.round(h / 10)));
      if (count !== paths.length) buildPaths(count);
      linesKey = '';
    },
    frame(time, dt) {
      const rgb = colorsRef.current.primary.join(', ');
      if (rgb !== linesKey || (drifted && time - linesDrawnAt >= 1)) {
        drawLines(rgb);
        linesKey = rgb;
        linesDrawnAt = time;
        drifted = false;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(lines, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${rgb})`;
      for (const path of paths) {
        path.t += path.speed * dt;
        if (path.t > 1) {
          path.t = 0;
          path.start = Math.min(1.25, Math.max(-0.25, path.start + ((Math.random() - 0.5) * 10) / height));
          drifted = true;
        }
        const pos = bezierPoint(path.t, ...curve(path));
        ctx.globalAlpha = 0.75 * visibility(pos.x, pos.y);
        ctx.fillRect(pos.x - 1.5, pos.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    },
  };
}
