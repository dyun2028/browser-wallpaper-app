(() => {
  'use strict';

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
  const DURATION = 1400;
  const EASE = 'cubic-bezier(.65,0,.35,1)';

  const stage = document.getElementById('stage');
  const bar = document.getElementById('bar');
  const toast = document.getElementById('toast');
  const empty = document.getElementById('empty');
  const counterEl = document.getElementById('counter');
  const nameEl = document.getElementById('name');
  const intervalSel = document.getElementById('interval');
  const effectSel = document.getElementById('effect');
  const playBtn = document.getElementById('playBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const fitBtn = document.getElementById('fitBtn');
  const folderInput = document.getElementById('folderInput');

  // ---------- settings ----------

  const settings = Object.assign(
    { interval: 10, effect: 'random', shuffle: false, contain: false, playing: true },
    loadSettings()
  );

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('wallpaper-settings')) || {}; }
    catch { return {}; }
  }

  function saveSettings() {
    try { localStorage.setItem('wallpaper-settings', JSON.stringify(settings)); }
    catch { /* storage blocked: settings just won't stick */ }
  }

  // ---------- state ----------

  let images = [];       // [{ src, name }]
  let order = [];        // indexes into images, in play order
  let pos = -1;          // position in order
  let currentLayer = null;
  let busy = false;
  let pending = null;    // navigation requested while animating
  let timer = null;
  let lastEffect = null;
  const cache = new Map();

  // ---------- helpers ----------

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cssUrl = (src) => `url("${src.replace(/"/g, '%22')}")`;

  function anim(el, frames, opts = {}) {
    return el.animate(frames, { duration: DURATION, easing: EASE, fill: 'both', ...opts }).finished;
  }

  function loadImage(src) {
    if (!cache.has(src)) {
      const img = new Image();
      img.src = src;
      cache.set(src, img.decode().then(() => img, () => img));
    }
    return cache.get(src);
  }

  // Where the picture actually sits on screen (matches background-size cover/contain).
  function imageRect(img) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const iw = img.naturalWidth || W, ih = img.naturalHeight || H;
    const s = settings.contain ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
    const w = iw * s, h = ih * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  // A rectangular slice of a picture, positioned so it lines up with the full layer.
  function makePiece(src, img, x, y, w, h) {
    const r = imageRect(img);
    const d = document.createElement('div');
    d.className = 'piece';
    x = Math.floor(x); y = Math.floor(y);
    w = Math.ceil(w) + 1; h = Math.ceil(h) + 1;
    Object.assign(d.style, {
      left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
      backgroundImage: cssUrl(src),
      backgroundSize: `${r.w}px ${r.h}px`,
      backgroundPosition: `${r.x - x}px ${r.y - y}px`,
    });
    stage.appendChild(d);
    return d;
  }

  function grid(cols, rows) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const cw = W / cols, ch = H / rows, cells = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        cells.push({ c, r, x: c * cw, y: r * ch, w: cw, h: ch, cx: (c + 0.5) / cols, cy: (r + 0.5) / rows });
    return cells;
  }

  function tileGrid(size) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const cols = Math.max(2, Math.round(W / size));
    const rows = Math.max(2, Math.round(H / size));
    return grid(cols, rows);
  }

  // ---------- transitions ----------
  // Each gets { from, to, fromSrc, toSrc, fromImg, toImg } where `to` is already
  // on top of `from` in the stage. They return a promise that resolves when done.

  const DIRS = [
    { name: 'left', x: -1, y: 0 }, { name: 'right', x: 1, y: 0 },
    { name: 'up', x: 0, y: -1 }, { name: 'down', x: 0, y: 1 },
  ];

  const effects = {
    'Crossfade': ({ to }) =>
      anim(to, [{ opacity: 0 }, { opacity: 1 }], { easing: 'ease-in-out' }),

    'Slide': ({ from, to }) => {
      const d = pick(DIRS);
      const off = (k) => `translate(${d.x * k * 100}%, ${d.y * k * 100}%)`;
      return Promise.all([
        anim(to, [{ transform: off(-1) }, { transform: 'none' }]),
        anim(from, [{ transform: 'none' }, { transform: off(1) }]),
      ]);
    },

    'Parallax push': ({ from, to }) => {
      const d = pick(DIRS);
      return Promise.all([
        anim(to, [{ transform: `translate(${-d.x * 100}%, ${-d.y * 100}%)` }, { transform: 'none' }]),
        anim(from, [
          { transform: 'none', filter: 'brightness(1)' },
          { transform: `translate(${d.x * 35}%, ${d.y * 35}%) scale(.9)`, filter: 'brightness(.3)' },
        ]),
      ]);
    },

    'Zoom through': ({ from, to }) => Promise.all([
      anim(from, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2.2)', opacity: 0 }], { easing: 'ease-in' }),
      anim(to, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { easing: 'cubic-bezier(.2,.8,.2,1)' }),
    ]),

    'Blur dissolve': ({ from, to }) => Promise.all([
      anim(from, [{ filter: 'blur(0) saturate(1)' }, { filter: 'blur(40px) saturate(2)' }]),
      anim(to, [{ opacity: 0, filter: 'blur(40px) saturate(2)' }, { opacity: 1, filter: 'blur(0) saturate(1)' }]),
    ]),

    'Spin': ({ from, to }) => {
      const s = Math.random() < 0.5 ? 1 : -1;
      return Promise.all([
        anim(from, [{ transform: 'none', opacity: 1 }, { transform: `rotate(${s * 90}deg) scale(.2)`, opacity: 0 }], { easing: 'ease-in' }),
        anim(to, [{ transform: `rotate(${-s * 270}deg) scale(0)` }, { transform: 'none' }], { easing: 'cubic-bezier(.2,.9,.3,1.1)' }),
      ]);
    },

    '3D flip': async ({ from, to }) => {
      const axis = Math.random() < 0.5 ? 'X' : 'Y';
      const s = Math.random() < 0.5 ? 1 : -1;
      stage.style.perspective = '1600px';
      to.style.visibility = 'hidden';
      await anim(from, [{ transform: 'none' }, { transform: `rotate${axis}(${s * 90}deg) scale(.85)` }], { duration: DURATION / 2, easing: 'ease-in' });
      to.style.visibility = '';
      await anim(to, [{ transform: `rotate${axis}(${-s * 90}deg) scale(.85)` }, { transform: 'none' }], { duration: DURATION / 2, easing: 'ease-out' });
    },

    'Cube': ({ from, to }) => {
      const s = Math.random() < 0.5 ? 1 : -1;
      stage.style.perspective = '1400px';
      to.style.transformOrigin = s > 0 ? 'left center' : 'right center';
      from.style.transformOrigin = s > 0 ? 'right center' : 'left center';
      return Promise.all([
        anim(to, [{ transform: `translateX(${s * 100}%) rotateY(${s * 90}deg)` }, { transform: 'none' }]),
        anim(from, [{ transform: 'none', filter: 'brightness(1)' }, { transform: `translateX(${-s * 100}%) rotateY(${-s * 90}deg)`, filter: 'brightness(.4)' }]),
      ]);
    },

    'Circle reveal': ({ to }) => {
      const at = `${rand(20, 80).toFixed(1)}% ${rand(20, 80).toFixed(1)}%`;
      return anim(to, [{ clipPath: `circle(0% at ${at})` }, { clipPath: `circle(150% at ${at})` }], { easing: 'cubic-bezier(.5,0,.2,1)' });
    },

    'Diamond': ({ to }) => anim(to, [
      { clipPath: 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)' },
      { clipPath: 'polygon(50% -60%, 160% 50%, 50% 160%, -60% 50%)' },
    ]),

    'Wipe': ({ to }) => {
      const start = pick(['inset(0 100% 0 0)', 'inset(0 0 0 100%)', 'inset(100% 0 0 0)', 'inset(0 0 100% 0)']);
      return anim(to, [{ clipPath: start }, { clipPath: 'inset(0 0 0 0)' }]);
    },

    'Barn doors': ({ to }) => {
      const vertical = Math.random() < 0.5;
      const start = vertical ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
      return anim(to, [{ clipPath: start }, { clipPath: 'inset(0 0 0 0)' }]);
    },

    'Blinds': async ({ to, toSrc, toImg }) => {
      const vertical = Math.random() < 0.5;
      const n = 12;
      const cells = vertical ? grid(n, 1) : grid(1, n);
      to.style.visibility = 'hidden';
      const pieces = cells.map((c) => makePiece(toSrc, toImg, c.x, c.y, c.w, c.h));
      const from = vertical ? 'scaleX(0)' : 'scaleY(0)';
      await Promise.all(pieces.map((p, i) => anim(p, [{ transform: from }, { transform: 'none' }],
        { duration: DURATION * 0.6, delay: i * (DURATION * 0.4 / n) })));
      to.style.visibility = '';
      pieces.forEach((p) => p.remove());
    },

    'Rain': async ({ to, toSrc, toImg }) => {
      const cells = grid(Math.max(8, Math.round(stage.clientWidth / 90)), 1);
      to.style.visibility = 'hidden';
      const pieces = cells.map((c) => makePiece(toSrc, toImg, c.x, c.y, c.w, c.h));
      await Promise.all(pieces.map((p) => anim(p,
        [{ transform: 'translateY(-100%)' }, { transform: 'none' }],
        { duration: DURATION * 0.7, delay: rand(0, DURATION * 0.45), easing: 'cubic-bezier(.3,1.35,.5,1)' })));
      to.style.visibility = '';
      pieces.forEach((p) => p.remove());
    },

    'Tiles': async ({ to, toSrc, toImg }) => {
      const cells = tileGrid(rand(110, 200));
      to.style.visibility = 'hidden';
      const pieces = cells.map((c) => makePiece(toSrc, toImg, c.x, c.y, c.w, c.h));
      const mode = pick(['random', 'diagonal', 'center']);
      const delayOf = (c) => mode === 'random' ? Math.random()
        : mode === 'diagonal' ? (c.cx + c.cy) / 2
        : Math.hypot(c.cx - 0.5, c.cy - 0.5) / 0.71;
      await Promise.all(pieces.map((p, i) => anim(p,
        [{ opacity: 0, transform: 'scale(.2) rotate(-25deg)' }, { opacity: 1, transform: 'none' }],
        { duration: DURATION * 0.55, delay: delayOf(cells[i]) * DURATION * 0.45, easing: 'cubic-bezier(.2,.8,.3,1.2)' })));
      to.style.visibility = '';
      pieces.forEach((p) => p.remove());
    },

    'Shatter': async ({ from, fromSrc, fromImg }) => {
      const cells = tileGrid(rand(80, 140));
      const ox = Math.random(), oy = Math.random();
      const pieces = cells.map((c) => makePiece(fromSrc, fromImg, c.x, c.y, c.w, c.h));
      from.style.visibility = 'hidden';
      await Promise.all(pieces.map((p, i) => {
        const c = cells[i];
        const dx = c.cx - ox, dy = c.cy - oy, dist = Math.hypot(dx, dy) || 0.01;
        const push = rand(300, 900);
        return anim(p, [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${(dx / dist) * push}px, ${(dy / dist) * push + 200}px) rotate(${rand(-400, 400)}deg) scale(${rand(0.2, 0.8)})`, opacity: 0 },
        ], { duration: DURATION * 0.8, delay: dist * DURATION * 0.25, easing: 'cubic-bezier(.4,0,.8,.6)' });
      }));
      pieces.forEach((p) => p.remove());
    },

    'Curtain': async ({ from, to, fromSrc, fromImg }) => {
      const W = stage.clientWidth, H = stage.clientHeight;
      const left = makePiece(fromSrc, fromImg, 0, 0, W / 2, H);
      const right = makePiece(fromSrc, fromImg, W / 2, 0, W / 2, H);
      from.style.visibility = 'hidden';
      await Promise.all([
        anim(left, [{ transform: 'none' }, { transform: 'translateX(-102%) skewY(4deg)' }]),
        anim(right, [{ transform: 'none' }, { transform: 'translateX(102%) skewY(-4deg)' }]),
        anim(to, [{ transform: 'scale(1.25)', filter: 'brightness(.4)' }, { transform: 'none', filter: 'brightness(1)' }]),
      ]);
      left.remove(); right.remove();
    },

    'Glitch': ({ to }) => {
      const frames = [];
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (i === steps) { frames.push({ offset: 1, opacity: 1, transform: 'none', filter: 'none', clipPath: 'inset(0 0 0 0)' }); break; }
        const top = rand(0, 90), h = rand(5, 60) * (0.3 + t);
        frames.push({
          offset: t,
          opacity: t < 0.1 ? 0 : 1,
          transform: `translate(${rand(-40, 40) * (1 - t)}px, ${rand(-8, 8) * (1 - t)}px) skewX(${rand(-10, 10) * (1 - t)}deg)`,
          filter: `hue-rotate(${rand(-180, 180) * (1 - t)}deg) saturate(${1 + 3 * (1 - t)}) contrast(${1 + (1 - t)})`,
          clipPath: t > 0.75 ? 'inset(0 0 0 0)' : `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`,
        });
      }
      return anim(to, frames, { duration: DURATION * 0.75, easing: 'steps(1, end)' });
    },
  };

  const effectNames = Object.keys(effects);

  function chooseEffect() {
    if (settings.effect !== 'random' && effects[settings.effect]) return settings.effect;
    let name;
    do { name = pick(effectNames); } while (name === lastEffect && effectNames.length > 1);
    lastEffect = name;
    return name;
  }

  // ---------- showing images ----------

  function makeLayer(src) {
    const el = document.createElement('div');
    el.className = 'layer';
    el.style.backgroundImage = cssUrl(src);
    return el;
  }

  function cleanLayer(el) {
    el.getAnimations().forEach((a) => a.cancel());
    el.removeAttribute('style');
    el.style.backgroundImage = el.dataset.bg;
  }

  async function show(newPos, { animate = true } = {}) {
    if (!images.length) return;
    if (busy) { pending = newPos; return; }
    busy = true;
    stopTimer();

    pos = ((newPos % order.length) + order.length) % order.length;
    const item = images[order[pos]];
    const toImg = await loadImage(item.src);
    updateInfo(item);

    const from = currentLayer;
    const fromSrc = from && from.dataset.src;
    const fromImg = from && await loadImage(fromSrc);

    const to = makeLayer(item.src);
    to.dataset.bg = to.style.backgroundImage;
    stage.appendChild(to);

    if (from && animate) {
      const name = chooseEffect();
      showToast(name);
      try {
        await effects[name]({ from, to, fromSrc, toSrc: item.src, fromImg, toImg });
      } catch (err) {
        console.warn('Transition failed', name, err);
      }
    }

    to.dataset.src = item.src;
    if (from) from.remove();
    stage.querySelectorAll('.piece').forEach((p) => p.remove());
    stage.style.perspective = '';
    cleanLayer(to);
    currentLayer = to;
    busy = false;

    // warm up the next picture so the next switch starts instantly
    if (order.length > 1) loadImage(images[order[(pos + 1) % order.length]].src);

    if (pending !== null) {
      const p = pending;
      pending = null;
      show(p);
    } else {
      startTimer();
    }
  }

  const next = () => show((pending ?? pos) + 1);
  const prev = () => show((pending ?? pos) - 1);

  function updateInfo(item) {
    counterEl.textContent = `${pos + 1} / ${order.length}`;
    nameEl.textContent = item.name;
    document.title = `${item.name} · Wallpaper Changer`;
  }

  let toastTimer;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  // ---------- autoplay ----------

  function startTimer() {
    stopTimer();
    if (settings.playing && images.length > 1) timer = setTimeout(next, settings.interval * 1000);
  }

  function stopTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function togglePlay() {
    settings.playing = !settings.playing;
    saveSettings();
    syncControls();
    showToast(settings.playing ? 'Playing' : 'Paused');
    if (!busy) startTimer();
  }

  // ---------- image list ----------

  function buildOrder(keepIndex) {
    order = images.map((_, i) => i);
    if (settings.shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    if (keepIndex != null) {
      // keep showing the same picture, but move it to the front of the new order
      const at = order.indexOf(keepIndex);
      if (at > 0) [order[0], order[at]] = [order[at], order[0]];
      pos = 0;
    }
  }

  function setImages(list) {
    const seen = new Set();
    images = list
      .filter((it) => !seen.has(it.src) && seen.add(it.src))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    empty.hidden = images.length > 0;
    if (!images.length) {
      counterEl.textContent = '0 / 0';
      nameEl.textContent = '';
      return;
    }
    buildOrder();
    if (currentLayer) { currentLayer.remove(); currentLayer = null; }
    pending = null;
    show(0, { animate: false });
  }

  function fromNames(names) {
    return names
      .filter((n) => IMAGE_EXT.test(n))
      .map((n) => ({ name: n.split('/').pop(), src: 'img/' + n.split('/').map(encodeURIComponent).join('/') }));
  }

  // When served over http, many servers list folder contents. Try that first.
  async function fromDirectoryListing() {
    if (!/^https?:$/.test(location.protocol)) return [];
    try {
      const res = await fetch('img/', { cache: 'no-store' });
      if (!res.ok) return [];
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const names = [...doc.querySelectorAll('a[href]')]
        .map((a) => decodeURIComponent(a.getAttribute('href').split(/[?#]/)[0].split('/').filter(Boolean).pop() || ''))
        .filter((n) => IMAGE_EXT.test(n));
      return fromNames([...new Set(names)]);
    } catch {
      return [];
    }
  }

  let objectUrls = [];
  function fromFiles(files) {
    const imgs = [...files].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name));
    if (!imgs.length) { showToast('No pictures found there'); return; }
    objectUrls.forEach(URL.revokeObjectURL);
    cache.clear();
    objectUrls = imgs.map((f) => URL.createObjectURL(f));
    setImages(imgs.map((f, i) => ({ name: f.name, src: objectUrls[i] })));
    showToast(`Loaded ${imgs.length} picture${imgs.length === 1 ? '' : 's'}`);
  }

  async function filesFromDrop(dt) {
    const entries = [...dt.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return [...dt.files];
    const out = [];
    const walk = async (entry) => {
      if (entry.isFile) {
        out.push(await new Promise((res, rej) => entry.file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  // ---------- controls ----------

  function syncControls() {
    playBtn.classList.toggle('paused', !settings.playing);
    shuffleBtn.classList.toggle('on', settings.shuffle);
    fitBtn.classList.toggle('on', settings.contain);
    document.body.classList.toggle('contain', settings.contain);
    intervalSel.value = String(settings.interval);
    effectSel.value = settings.effect;
  }

  for (const name of effectNames) effectSel.add(new Option(name, name));
  if (!effects[settings.effect]) settings.effect = 'random';
  if (![...intervalSel.options].some((o) => o.value === String(settings.interval))) settings.interval = 10;

  const actions = {
    prev,
    next,
    play: togglePlay,
    shuffle() {
      settings.shuffle = !settings.shuffle;
      saveSettings();
      syncControls();
      if (images.length) buildOrder(order[pos]);
      if (images.length) updateInfo(images[order[pos]]);
      showToast(settings.shuffle ? 'Shuffle on' : 'Shuffle off');
    },
    fit() {
      settings.contain = !settings.contain;
      saveSettings();
      syncControls();
      showToast(settings.contain ? 'Show whole picture' : 'Fill screen');
    },
    pick: () => folderInput.click(),
    fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    },
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) { actions[btn.dataset.action](); return; }
    if (e.target.closest('#stage')) next();
  });

  intervalSel.addEventListener('change', () => {
    settings.interval = Number(intervalSel.value);
    saveSettings();
    if (!busy) startTimer();
  });

  effectSel.addEventListener('change', () => {
    settings.effect = effectSel.value;
    saveSettings();
    effectSel.blur();
  });

  folderInput.addEventListener('change', () => {
    fromFiles(folderInput.files);
    folderInput.value = '';
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input')) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowright' || key === 'pagedown') next();
    else if (key === 'arrowleft' || key === 'pageup') prev();
    else if (key === ' ') togglePlay();
    else if (key === 'f') actions.fullscreen();
    else if (key === 's') actions.shuffle();
    else if (key === 'z') actions.fit();
    else if (key === 'h') { document.body.classList.toggle('hide-ui'); return; }
    else return;
    e.preventDefault();
  });

  // Swipe on touch screens
  let touchX = null;
  stage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); dx < 0 ? next() : prev(); }
  });

  // Hide the controls and cursor when the mouse is still
  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (empty.hidden && !bar.matches(':hover')) document.body.classList.add('idle');
    }, 2500);
  }
  ['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

  // Drag and drop pictures or a folder
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    fromFiles(await filesFromDrop(e.dataTransfer));
  });

  // Keep pieces lined up if the window changes size mid-transition
  window.addEventListener('resize', () => stage.querySelectorAll('.piece').forEach((p) => p.remove()));

  // ---------- start ----------

  async function init() {
    syncControls();
    wake();
    let list = await fromDirectoryListing();
    if (!list.length && Array.isArray(window.WALLPAPERS)) list = fromNames(window.WALLPAPERS);
    setImages(list);
  }

  init();
})();
