/* Animated dusk sky for the home hero: gradient, drifting cloud bands,
 * layered dunes and rising light motes. Pure canvas, no assets. */
(function () {
  'use strict';
  const canvas = document.getElementById('hero-sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1, motes = [], stars = [], clouds = [];
  let pointer = { x: 0.5, y: 0.5 }, target = { x: 0.5, y: 0.5 };

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const area = w * h;
    stars = Array.from({ length: Math.round(area / 9000) }, () => ({
      x: Math.random(), y: Math.random() * 0.55, r: rand(0.4, 1.3), p: Math.random() * Math.PI * 2
    }));
    motes = Array.from({ length: Math.round(area / 16000) + 12 }, spawnMote);
    clouds = Array.from({ length: 7 }, (_, i) => ({
      y: 0.18 + i * 0.07, speed: rand(4, 12) * (i % 2 ? 1 : -1), offset: rand(0, 1000),
      alpha: rand(0.05, 0.12), scale: rand(0.8, 1.6)
    }));
  }

  function spawnMote(initial = true) {
    return {
      x: Math.random(), y: initial ? Math.random() : 1.05,
      r: rand(1, 3.2), vy: rand(0.008, 0.03), drift: rand(-0.01, 0.01),
      phase: Math.random() * Math.PI * 2, hue: Math.random() < 0.8 ? 42 : 200
    };
  }

  // Smooth pseudo-noise ridge for dunes.
  function ridge(x, seed, amp, freq) {
    return Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.3 + seed * 1.7) * amp * 0.35 + Math.sin(x * freq * 5.1 + seed * 0.3) * amp * 0.12;
  }

  function drawDune(baseY, seed, amp, freq, color, parallax) {
    const shift = (pointer.x - 0.5) * parallax;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) {
      ctx.lineTo(x, baseY + ridge((x + shift) / w, seed, amp, freq));
    }
    ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  function frame(t) {
    const time = t / 1000;
    pointer.x += (target.x - pointer.x) * 0.04;
    pointer.y += (target.y - pointer.y) * 0.04;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#141a38');
    g.addColorStop(0.45, '#3b2f57');
    g.addColorStop(0.72, '#c9786a');
    g.addColorStop(0.9, '#f2c46d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // sun glow
    const sx = w * (0.68 + (pointer.x - 0.5) * 0.03), sy = h * 0.78;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.45);
    sun.addColorStop(0, 'rgba(255, 240, 200, 0.85)');
    sun.addColorStop(0.15, 'rgba(255, 210, 140, 0.35)');
    sun.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);

    // stars
    for (const s of stars) {
      const a = 0.35 + 0.35 * Math.sin(time * 1.5 + s.p);
      ctx.fillStyle = `rgba(255, 250, 235, ${a * (1 - s.y * 1.4)})`;
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // cloud bands
    for (const c of clouds) {
      const y = c.y * h + (pointer.y - 0.5) * 10;
      ctx.fillStyle = `rgba(255, 236, 220, ${c.alpha})`;
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 260 + c.offset + time * c.speed) % (w + 400) + (w + 400)) % (w + 400) - 200;
        ctx.beginPath();
        ctx.ellipse(cx, y, 140 * c.scale, 14 * c.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // dunes, back to front
    drawDune(h * 0.80, 1.3, h * 0.05, 3.1, 'rgba(120, 76, 92, 0.75)', 20);
    drawDune(h * 0.86, 4.1, h * 0.045, 4.2, 'rgba(70, 44, 70, 0.9)', 40);
    drawDune(h * 0.93, 7.7, h * 0.035, 5.3, '#1d1830', 70);

    // rising light motes
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      if (!reduced) {
        m.y -= m.vy / 60; m.x += Math.sin(time + m.phase) * m.drift / 60;
        if (m.y < -0.05) motes[i] = spawnMote(false);
      }
      const x = m.x * w + (pointer.x - 0.5) * 30 * m.r, y = m.y * h;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, m.r * 6);
      glow.addColorStop(0, `hsla(${m.hue}, 95%, 85%, 0.9)`);
      glow.addColorStop(1, `hsla(${m.hue}, 95%, 70%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, m.r * 6, 0, Math.PI * 2); ctx.fill();
    }

    if (!reduced) requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', e => {
    target.x = e.clientX / window.innerWidth; target.y = e.clientY / window.innerHeight;
  });
  resize();
  requestAnimationFrame(frame);
})();
