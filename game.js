(() => {
  "use strict";

  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: true });

  const $score = document.getElementById("score");
  const $lives = document.getElementById("lives");
  const $difficulty = document.getElementById("difficulty");

  const $btnStart = document.getElementById("btnStart");
  const $btnPause = document.getElementById("btnPause");
  const $btnRestart = document.getElementById("btnRestart");

  const $overlay = document.getElementById("overlay");
  const $overlayTitle = document.getElementById("overlayTitle");
  const $overlayText = document.getElementById("overlayText");
  const $btnOverlayPrimary = document.getElementById("btnOverlayPrimary");
  const $btnOverlaySecondary = document.getElementById("btnOverlaySecondary");
  const $help = document.getElementById("help");

  if (!canvas || !ctx) return;

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const BASE_W = 960;
  const BASE_H = 540;

  function resizeCanvas() {
    // Keep internal resolution stable; scale via CSS.
    canvas.width = Math.round(BASE_W * DPR);
    canvas.height = Math.round(BASE_H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function nowMs() {
    return performance.now();
  }

  function canvasPosFromClient(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * BASE_W;
    const y = ((clientY - r.top) / r.height) * BASE_H;
    return { x, y };
  }

  const keys = new Set();
  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright")
        e.preventDefault();
      keys.add(k);

      if (k === "p" || k === "escape") {
        if (state.running) togglePause();
      }
    },
    { passive: false }
  );
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()), { passive: true });

  const pointer = {
    active: false,
    offsetX: 0,
    offsetY: 0,
    isTouch: false,
    startX: 0,
    lastX: 0,
  };

  function onPointerDown(e) {
    if (!state.running || state.paused) return;
    pointer.active = true;
    pointer.isTouch = e.pointerType === "touch";
    const p = canvasPosFromClient(e.clientX, e.clientY);
    pointer.startX = p.x;
    pointer.lastX = p.x;
    if (!pointer.isTouch) {
      // Mouse: drag to move precisely.
      pointer.offsetX = p.x - player.x;
      pointer.offsetY = p.y - player.y;
    }
  }
  function onPointerMove(e) {
    if (!pointer.active) return;
    const p = canvasPosFromClient(e.clientX, e.clientY);
    if (pointer.isTouch) {
      // Touch: swipe left/right to emulate A/D.
      const dxStep = p.x - pointer.lastX;
      pointer.lastX = p.x;
      // dxStep is per event; scale so continuous swiping feels like holding A/D.
      state.touchAxisX = clamp(dxStep / 10, -1, 1);
    } else {
      player.x = clamp(p.x - pointer.offsetX, 16, BASE_W - 16);
      player.y = clamp(p.y - pointer.offsetY, 18, BASE_H - 24);
    }
  }
  function onPointerUp() {
    pointer.active = false;
    pointer.isTouch = false;
    state.touchAxisX = 0;
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerup", onPointerUp, { passive: true });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: true });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const state = {
    running: false,
    paused: false,
    over: false,
    score: 0,
    lives: 10,
    difficulty: 1,
    t0: 0,
    lastT: 0,
    spawnTimer: 0,
    spawnEvery: 900,
    shake: 0,
    lastShotAt: 0,
    touchAxisX: 0,
  };

  const player = {
    x: BASE_W / 2,
    y: BASE_H - 70,
    vx: 0,
    vy: 0,
    w: 28,
    h: 34,
    speed: 330, // px/s
    invincibleUntil: 0,
  };

  /** @type {{x:number,y:number,v:number,w:number,h:number}[]} */
  const bullets = [];
  /** @type {{x:number,y:number,vx:number,vy:number,w:number,h:number,hp:number,type:"small"|"tank"}[]} */
  const enemies = [];
  /** @type {{x:number,y:number,vx:number,vy:number,life:number,color:string,r:number}[]} */
  const particles = [];
  /** @type {{text:string,x:number,y:number,vy:number,life:number}[]} */
  const floaters = [];

  function resetGame() {
    state.running = false;
    state.paused = false;
    state.over = false;
    state.score = 0;
    state.lives = 10;
    state.difficulty = 1;
    state.t0 = 0;
    state.lastT = 0;
    state.spawnTimer = 0;
    state.spawnEvery = 900;
    state.shake = 0;
    state.lastShotAt = 0;
    state.touchAxisX = 0;

    player.x = BASE_W / 2;
    player.y = BASE_H - 70;
    player.vx = 0;
    player.vy = 0;
    player.invincibleUntil = 0;

    bullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    floaters.length = 0;

    syncHud();
    showOverlay("飞机大战", "点击开始进入游戏", false);
  }

  function syncHud() {
    $score.textContent = String(state.score);
    $lives.textContent = String(state.lives);
    $difficulty.textContent = `${state.difficulty.toFixed(1)}×`;
  }

  function showOverlay(title, text, showHelp) {
    $overlayTitle.textContent = title;
    $overlayText.textContent = text;
    $help.hidden = !showHelp;
    $overlay.hidden = false;
    // Fallback for environments that don't honor [hidden] properly.
    $overlay.style.display = "";
  }

  function hideOverlay() {
    $overlay.hidden = true;
    $help.hidden = true;
    // Fallback for environments that don't honor [hidden] properly.
    $overlay.style.display = "none";
  }

  function setButtons() {
    $btnStart.disabled = state.running && !state.over;
    $btnPause.disabled = !state.running || state.over;
    $btnPause.textContent = state.paused ? "继续" : "暂停";
    $btnRestart.disabled = !state.running && !state.over ? true : false;
  }

  function startGame() {
    if (state.running && !state.over) return;
    state.running = true;
    state.paused = false;
    state.over = false;
    state.t0 = nowMs();
    state.lastT = state.t0;
    hideOverlay();
    setButtons();
    canvas.focus?.();
    requestAnimationFrame(frame);
  }

  function gameOver() {
    state.over = true;
    state.running = false;
    state.paused = false;
    setButtons();
    showOverlay("游戏结束", `你的分数：${state.score}。点击重新开始再来一局。`, false);
  }

  function togglePause() {
    if (!state.running || state.over) return;
    state.paused = !state.paused;
    setButtons();
    if (!state.paused) {
      state.lastT = nowMs();
      requestAnimationFrame(frame);
      hideOverlay();
    } else {
      showOverlay("已暂停", "按 P / ESC 或点击继续", false);
    }
  }

  function restartGame() {
    resetGame();
    setButtons();
  }

  function spawnEnemy() {
    const type = Math.random() < 0.18 ? "tank" : "small";
    const w = type === "tank" ? 46 : 30;
    const h = type === "tank" ? 54 : 34;
    const x = rand(16, BASE_W - 16 - w);
    const y = -h - rand(0, 40);
    const baseSpeed = type === "tank" ? rand(70, 110) : rand(110, 190);
    const vy = baseSpeed * (0.8 + 0.25 * Math.min(2, state.difficulty));
    const drift = rand(-40, 40) * (type === "tank" ? 0.6 : 1);
    enemies.push({
      x,
      y,
      vx: drift,
      vy,
      w,
      h,
      hp: type === "tank" ? 4 : 1,
      type,
    });
  }

  function shoot(t) {
    const fireDelay = 120; // ms
    if (t - state.lastShotAt < fireDelay) return;
    state.lastShotAt = t;

    const spread = 0.08 + Math.min(0.08, state.difficulty * 0.01);
    const v = 560;
    const x = player.x;
    const y = player.y - player.h / 2 - 6;

    bullets.push({ x, y, v, w: 4, h: 12 });
    if (state.difficulty >= 1.6) bullets.push({ x: x - 10, y, v: v * 0.98, w: 4, h: 12 });
    if (state.difficulty >= 2.2) bullets.push({ x: x + 10, y, v: v * 0.98, w: 4, h: 12 });

    // Tiny muzzle particles
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: x + rand(-2, 2),
        y: y + rand(-2, 2),
        vx: rand(-40, 40),
        vy: rand(-220, -120) * (1 + spread),
        life: rand(0.12, 0.2),
        color: "rgba(110,231,255,0.9)",
        r: rand(1.2, 2.2),
      });
    }
  }

  function addExplosion(x, y, big) {
    const n = big ? 26 : 14;
    const colors = big
      ? ["rgba(255,77,109,0.95)", "rgba(255,200,87,0.9)", "rgba(110,231,255,0.75)"]
      : ["rgba(110,231,255,0.9)", "rgba(167,139,250,0.85)"];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(big ? 60 : 40, big ? 260 : 180);
      particles.push({
        x: x + rand(-4, 4),
        y: y + rand(-4, 4),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - rand(40, 140),
        life: rand(big ? 0.35 : 0.22, big ? 0.7 : 0.48),
        color: colors[(Math.random() * colors.length) | 0],
        r: rand(big ? 1.8 : 1.2, big ? 3.8 : 2.8),
      });
    }
  }

  function addFloater(text, x, y) {
    floaters.push({ text, x, y, vy: -38, life: 0.85 });
  }

  function damagePlayer() {
    const t = nowMs();
    if (t < player.invincibleUntil) return;
    state.lives = Math.max(0, state.lives - 1);
    player.invincibleUntil = t + 1200;
    state.shake = 10;
    syncHud();
    addExplosion(player.x, player.y, true);
    addFloater("-1", player.x + 10, player.y);
    if (state.lives <= 0) gameOver();
  }

  function missEnemyPenalty(x, y) {
    // Enemy passed the bottom ("没接住"): lose 1 life.
    state.lives = Math.max(0, state.lives - 1);
    state.shake = Math.max(state.shake, 6);
    syncHud();
    addFloater("-1", x, y);
    if (state.lives <= 0) gameOver();
  }

  function updateDifficulty(t) {
    const elapsed = (t - state.t0) / 1000;
    const d = 1 + elapsed / 35;
    state.difficulty = Math.min(4.0, d);

    const targetSpawn = 920 - (state.difficulty - 1) * 170;
    state.spawnEvery = clamp(targetSpawn, 320, 920);
  }

  function update(dt, t) {
    updateDifficulty(t);

    // Movement
    let ax = 0;
    let ay = 0;
    if (keys.has("a") || keys.has("arrowleft")) ax -= 1;
    if (keys.has("d") || keys.has("arrowright")) ax += 1;
    if (keys.has("w") || keys.has("arrowup")) ay -= 1;
    if (keys.has("s") || keys.has("arrowdown")) ay += 1;

    // Touch swipe axis (mobile): acts like A/D with a bit of decay.
    ax += state.touchAxisX;
    state.touchAxisX *= Math.pow(0.001, dt); // ~fast decay to 0 within ~0.5s

    const mag = Math.hypot(ax, ay) || 1;
    ax /= mag;
    ay /= mag;

    player.x = clamp(player.x + ax * player.speed * dt, 16, BASE_W - 16);
    player.y = clamp(player.y + ay * player.speed * dt, 18, BASE_H - 24);

    // Shooting: auto-fire; space for "more intent" (still same rate)
    if (state.running && !state.over) {
      const want = true;
      if (want) shoot(t);
      if (keys.has(" ")) shoot(t);
    }

    // Spawning
    state.spawnTimer += dt * 1000;
    while (state.spawnTimer >= state.spawnEvery) {
      state.spawnTimer -= state.spawnEvery;
      spawnEnemy();
      if (state.difficulty >= 2.6 && Math.random() < 0.3) spawnEnemy();
    }

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y -= b.v * dt;
      if (b.y < -40) bullets.splice(i, 1);
    }

    // Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.x < 8 || e.x + e.w > BASE_W - 8) e.vx *= -1;
      if (e.y > BASE_H + 20) {
        enemies.splice(i, 1);
        missEnemyPenalty(e.x + e.w / 2, BASE_H - 26);
      }
    }

    // Collisions: bullets vs enemies
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      const bx = b.x - b.w / 2;
      const by = b.y - b.h;
      let hit = false;

      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const e = enemies[ei];
        if (aabb(bx, by, b.w, b.h, e.x, e.y, e.w, e.h)) {
          hit = true;
          e.hp -= 1;
          addExplosion(b.x, b.y, false);
          if (e.hp <= 0) {
            enemies.splice(ei, 1);
            const gain = e.type === "tank" ? 30 : 10;
            state.score += gain;
            state.shake = Math.max(state.shake, e.type === "tank" ? 8 : 4);
            addExplosion(e.x + e.w / 2, e.y + e.h / 2, e.type === "tank");
            addFloater(`+${gain}`, e.x + e.w / 2, e.y + e.h / 2);
            syncHud();
          }
          break;
        }
      }

      if (hit) bullets.splice(bi, 1);
    }

    // Collisions: player vs enemies
    const px = player.x - player.w / 2;
    const py = player.y - player.h / 2;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (aabb(px, py, player.w, player.h, e.x, e.y, e.w, e.h)) {
        enemies.splice(i, 1);
        damagePlayer();
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 520 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Floaters
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    // Screen shake decay
    state.shake = Math.max(0, state.shake - 18 * dt);
  }

  function drawStarfield(t) {
    const tt = t / 1000;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    // simple stars
    const layers = [
      { n: 60, s: 18, a: 0.35 },
      { n: 38, s: 34, a: 0.28 },
      { n: 22, s: 58, a: 0.22 },
    ];
    for (const L of layers) {
      ctx.fillStyle = `rgba(255,255,255,${L.a})`;
      for (let i = 0; i < L.n; i++) {
        const x = ((i * 97.3) % BASE_W) + ((tt * 13) % 1);
        const y = ((i * 173.7) % BASE_H) + ((tt * L.s) % BASE_H);
        const yy = (y % BASE_H) - 2;
        ctx.fillRect(x % BASE_W, yy, 1, 1);
      }
    }

    ctx.restore();
  }

  function drawPlayer(t) {
    const blink = nowMs() < player.invincibleUntil && Math.floor(t / 90) % 2 === 0;
    if (blink) return;

    const x = player.x;
    const y = player.y;

    // body
    ctx.save();
    ctx.translate(x, y);

    // glow
    const g = ctx.createRadialGradient(0, 6, 2, 0, 6, 40);
    g.addColorStop(0, "rgba(110,231,255,0.22)");
    g.addColorStop(1, "rgba(110,231,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 10, 26, 34, 0, 0, Math.PI * 2);
    ctx.fill();

    // ship
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = "rgba(110,231,255,0.9)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(0, -player.h / 2);
    ctx.lineTo(12, 6);
    ctx.lineTo(0, player.h / 2);
    ctx.lineTo(-12, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // core
    ctx.fillStyle = "rgba(167,139,250,0.85)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;

      ctx.save();
      ctx.translate(cx, cy);

      const isTank = e.type === "tank";
      const main = isTank ? "rgba(255,77,109,0.9)" : "rgba(255,255,255,0.85)";
      const edge = isTank ? "rgba(255,200,87,0.9)" : "rgba(167,139,250,0.85)";

      // glow
      const gg = ctx.createRadialGradient(0, 0, 6, 0, 0, isTank ? 46 : 36);
      gg.addColorStop(0, isTank ? "rgba(255,77,109,0.16)" : "rgba(167,139,250,0.14)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(0, 0, e.w * 0.9, e.h * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();

      // hull
      ctx.fillStyle = main;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -e.h / 2);
      ctx.lineTo(e.w / 2, e.h * 0.05);
      ctx.lineTo(0, e.h / 2);
      ctx.lineTo(-e.w / 2, e.h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (isTank) {
        // hp bar
        const maxHp = 4;
        const p = clamp(e.hp / maxHp, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(-18, -e.h / 2 - 10, 36, 4);
        ctx.fillStyle = `rgba(48,227,166,${0.8})`;
        ctx.fillRect(-18, -e.h / 2 - 10, 36 * p, 4);
      }

      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.fillStyle = "rgba(110,231,255,0.95)";
    for (const b of bullets) {
      ctx.fillRect(b.x - b.w / 2, b.y - b.h, b.w, b.h);
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const a = clamp(p.life / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloaters() {
    ctx.save();
    ctx.font = "700 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / 0.85, 0, 1);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function draw(t) {
    const sx = state.shake ? rand(-state.shake, state.shake) : 0;
    const sy = state.shake ? rand(-state.shake, state.shake) : 0;

    ctx.save();
    ctx.translate(sx, sy);

    ctx.clearRect(-20, -20, BASE_W + 40, BASE_H + 40);
    drawStarfield(t);

    drawBullets();
    drawEnemies();
    drawPlayer(t);
    drawParticles();
    drawFloaters();

    // vignette
    const vg = ctx.createRadialGradient(BASE_W / 2, BASE_H / 2, 60, BASE_W / 2, BASE_H / 2, 520);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    ctx.restore();
  }

  function frame(t) {
    if (!state.running || state.paused || state.over) return;
    const dt = clamp((t - state.lastT) / 1000, 0, 0.033);
    state.lastT = t;
    update(dt, t);
    draw(t);
    requestAnimationFrame(frame);
  }

  $btnStart.addEventListener("click", () => startGame());
  $btnPause.addEventListener("click", () => {
    if (!state.running && !state.over) return;
    if (state.over) return;
    togglePause();
  });
  $btnRestart.addEventListener("click", () => {
    restartGame();
    startGame();
  });

  $btnOverlayPrimary.addEventListener("click", () => {
    if (state.over) {
      restartGame();
      startGame();
      return;
    }
    if (state.paused) {
      togglePause();
      return;
    }
    startGame();
  });

  $btnOverlaySecondary.addEventListener("click", () => {
    $help.hidden = !$help.hidden;
  });

  // Init UI
  resetGame();
  setButtons();
  draw(nowMs());
})();
