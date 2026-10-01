import React, { useEffect, useRef } from 'react';

const PURPLE = [108, 92, 231];
const CYAN = [0, 206, 201];

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * The landing page's hero background: a bundle of flowing lines that fans in
 * wide on the left and narrows to the right, like visitors funnelling into
 * leads, with bright beams travelling along some of them. Plain canvas, no
 * dependencies. It pauses while scrolled out of view and draws one still
 * frame for visitors with "reduce motion" on. The pointer gently pushes the
 * lines aside.
 */
export default function LandingBackground({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    // Each line gets a fixed offset in the bundle, a wave phase and — for a
    // few — a travelling beam.
    const LINE_COUNT = 34;
    const lines = Array.from({ length: LINE_COUNT }, (_, i) => {
      const offset = (i / (LINE_COUNT - 1)) * 2 - 1;
      return {
        offset,
        phase: i * 0.21,
        alpha: 0.10 + 0.22 * (1 - Math.abs(offset)),
        beam: i % 4 === 1 ? { speed: 0.12 + ((i * 37) % 10) / 60, seed: (i * 977) % 1000, len: 90 + ((i * 53) % 80) } : null,
      };
    });

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function lineY(line, x, t) {
      const u = x / width;
      const spread = 0.85 - 0.72 * smoothstep(u * 1.05);
      const amp = height * 0.07 * (0.35 + spread);
      let y = height * 0.58
        + line.offset * height * 0.42 * spread
        + amp * Math.sin(x * 0.0042 + t * 0.00055 + line.phase)
        + amp * 0.6 * Math.sin(x * 0.0016 - t * 0.0004 + line.phase * 0.35);
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 40000) {
        const push = (1 - d2 / 40000) * 28;
        y += dy >= 0 ? push : -push;
      }
      return y;
    }

    function tracePath(line, t) {
      ctx.beginPath();
      const step = 12;
      for (let x = -20; x <= width + 20; x += step) {
        const y = lineY(line, x, t);
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }

    function draw(t) {
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, `rgba(${PURPLE.join(',')},1)`);
      gradient.addColorStop(1, `rgba(${CYAN.join(',')},1)`);

      const pathLength = width * 1.25;
      for (const line of lines) {
        tracePath(line, t);
        ctx.setLineDash([]);
        ctx.strokeStyle = gradient;
        ctx.globalAlpha = line.alpha;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (line.beam) {
          const { speed, seed, len } = line.beam;
          const cycle = pathLength + len;
          const head = ((t * speed + seed * 3) % cycle);
          ctx.setLineDash([len, cycle]);
          ctx.lineDashOffset = len - head;
          ctx.globalAlpha = 0.18;
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop(t) {
      if (visible) draw(t);
      frame = requestAnimationFrame(loop);
    }

    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = e.clientX - rect.left;
      pointer.ty = e.clientY - rect.top;
    }

    function onPointerLeave() {
      pointer.tx = -9999;
      pointer.ty = -9999;
    }

    resize();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { resize(); if (reduceMotion) draw(12000); })
      : null;
    resizeObserver?.observe(canvas);

    if (reduceMotion) {
      draw(12000);
      return () => resizeObserver?.disconnect();
    }

    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; })
      : null;
    intersectionObserver?.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
