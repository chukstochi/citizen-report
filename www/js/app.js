/* Citizen Report: built with Cordova + App.js (Zepto). Each App.controller below runs when its page is loaded. */
(function () {
  const API = (window.CR_API || 'http://localhost:8000').replace(/\/$/, '');
  const ICON = { Accident: '🚗', Fighting: '🥊', Rioting: '📢', Robbery: '🎒', Fire: '🔥', Flooding: '🌊', Other: '📍' };
  const q = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let token = localStorage.getItem('cr_token'), user = localStorage.getItem('cr_user') || '', lastId = +localStorage.getItem('cr_last') || 0;
  let cats = [], filter = '', byId = {}, here = '', homeReload = null;

  const ago = (t) => {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - t));
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  };
  function toast(msg) {
    const t = q('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function banner(msg) {
    const b = q('#banner'); b.textContent = msg + '  (tap to view)'; b.classList.add('show');
    clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.remove('show'), 7000);
  }
  function osNotify(text) { // phone notification, only if the optional local-notification plugin is installed
    try { const n = window.cordova && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local;
      if (n) n.schedule({ id: Date.now() % 100000, title: 'Citizen Report', text, foreground: true }); } catch (e) { /* ignore */ }
  }

  async function api(path, opts = {}) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (opts.body && !(opts.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
    let res;
    try { res = await fetch(API + path, { ...opts, headers, signal: ctl.signal }); }
    catch { throw new Error('Cannot reach the server. Check your internet and try again.'); }
    finally { clearTimeout(timer); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { if (res.status === 401 && token) logout(); throw new Error(data.detail || 'Something went wrong.'); }
    return data;
  }
  function logout() { token = null; user = ''; localStorage.removeItem('cr_token'); localStorage.removeItem('cr_user'); App.load('login'); }
  async function ensureCats() { if (!cats.length) cats = await api('/categories').catch(() => []); return cats; }

  const card = (i) => `<div class="card" data-id="${i.id}">${i.photo ? `<img src="${API}/uploads/${esc(i.photo)}" alt="" loading="lazy">` : ''}<div class="row"><span class="cat-tag">${ICON[i.category] || '📍'} ${esc(i.category)}</span><span class="badge s-${esc(i.status).toLowerCase()}">${esc(i.status)}</span></div><b>${esc(i.title)}</b><div class="muted">${ago(i.created)} · ${esc(i.author)}</div></div>`;

  async function fill(el, path) {
    el.innerHTML = '<div class="card sk"></div>'.repeat(3);
    try {
      const l = await api(path);
      l.forEach((i) => (byId[i.id] = i));
      el.innerHTML = l.map(card).join('') || '<p class="muted empty">No incidents here yet.</p>';
      return l;
    } catch (e) { el.innerHTML = '<p class="muted empty">Could not load incidents.</p>'; toast(e.message); return []; }
  }
  function openCards(page) { // tap a card to see the full incident
    page.addEventListener('click', (e) => { const k = e.target.closest('.card[data-id]'); if (k && byId[k.dataset.id]) App.load('detail', byId[k.dataset.id]); });
  }

  function shrink(file) { // smaller photos upload faster on mobile data
    return new Promise((ok) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); c.toBlob((b) => ok(b || file), 'image/jpeg', 0.8);
      };
      img.onerror = () => ok(file); img.src = url;
    });
  }

  async function auth(path, btn, page) {
    const name = q('.user', page).value.trim().toLowerCase(), pass = q('.pass', page).value;
    if (!name || !pass) return toast('Enter your username and password.');
    btn.classList.add('busy');
    try {
      const r = await api(path, { method: 'POST', body: { username: name, password: pass } });
      token = r.token; user = name; localStorage.setItem('cr_token', token); localStorage.setItem('cr_user', user);
      App.load('home');
    } catch (e) { toast(e.message); }
    btn.classList.remove('busy');
  }

  async function poll() { // checks for new incidents from other people
    if (!token || document.hidden || !lastId) return;
    try {
      const l = await api('/incidents?after=' + lastId);
      if (!l.length) return;
      lastId = Math.max(...l.map((i) => i.id)); localStorage.setItem('cr_last', lastId);
      const others = l.filter((i) => i.author !== user);
      if (others.length) {
        const t = others.length === 1 ? 'New incident: ' + others[0].title : others.length + ' new incidents reported';
        banner(t); osNotify(t);
      }
      if (here === 'home' && homeReload) homeReload();
    } catch (e) { /* stay quiet, try again next time */ }
  }

  /* ---------- pages ---------- */
  App.controller('login', function (page) {
    $(page).on('appShow', () => { here = 'login'; });
    q('.go', page).onclick = (e) => auth('/login', e.currentTarget, page);
    q('.reg', page).onclick = (e) => auth('/register', e.currentTarget, page);
  });

  App.controller('home', function (page) {
    const list = q('.list', page), chips = q('.chips', page);
    async function load() {
      if (!token) return App.load('login');
      await ensureCats();
      chips.innerHTML = ['', ...cats].map((c) => `<span class="chip${c === filter ? ' on' : ''}" data-c="${esc(c)}">${c ? (ICON[c] || '') + ' ' + esc(c) : 'All'}</span>`).join('');
      const l = await fill(list, '/incidents' + (filter ? '?category=' + encodeURIComponent(filter) : ''));
      if (!filter && l.length) { lastId = Math.max(lastId, ...l.map((i) => i.id)); localStorage.setItem('cr_last', lastId); }
    }
    homeReload = load;
    page.addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { filter = c.dataset.c; load(); } });
    openCards(page);
    $(page).on('appShow', () => { here = 'home'; load(); });
  });

  App.controller('add', function (page) {
    let photo = null, pos = null;
    const cat = q('.cat', page), preview = q('.preview', page), loc = q('.loctext', page);
    ensureCats().then(() => { cat.innerHTML = '<option value="">Choose a category</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join(''); });
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    picker.onchange = async () => {
      if (!picker.files[0]) return;
      photo = await shrink(picker.files[0]); preview.src = URL.createObjectURL(photo); preview.hidden = false;
    };
    q('.photo', page).onclick = () => picker.click();
    q('.loc', page).onclick = () => {
      if (!navigator.geolocation) return toast('Location is not available on this device.');
      loc.textContent = 'Finding your location...';
      navigator.geolocation.getCurrentPosition(
        (p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude }; loc.textContent = `Location added (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`; },
        () => { loc.textContent = 'Location not added yet.'; toast('Could not get your location. Check permissions.'); },
        { enableHighAccuracy: true, timeout: 10000 });
    };
    q('.send', page).onclick = async (e) => {
      const title = q('.title', page).value.trim(), category = cat.value, b = e.currentTarget;
      if (!title || !category) return toast('Add a title and choose a category.');
      const f = new FormData();
      f.append('title', title); f.append('category', category); f.append('description', q('.desc', page).value.trim());
      if (pos) { f.append('lat', pos.lat); f.append('lng', pos.lng); }
      if (photo) f.append('photo', photo, 'incident.jpg');
      b.classList.add('busy'); b.textContent = 'Sending...';
      try { await api('/incidents', { method: 'POST', body: f }); toast('Report sent. Thank you.'); App.back(); }
      catch (err) { toast(err.message); }
      b.classList.remove('busy'); b.textContent = 'Submit report';
    };
    $(page).on('appShow', () => { here = 'add'; });
  });

  App.controller('mine', function (page) {
    openCards(page);
    q('.out', page).onclick = logout;
    $(page).on('appShow', () => { here = 'mine'; if (!token) return App.load('login'); fill(q('.list', page), '/incidents/mine'); });
  });

  App.controller('detail', function (page, i) {
    if (!i) return App.back();
    const has = i.lat != null && i.lng != null, d = 0.005;
    q('.detail', page).innerHTML = (i.photo ? `<img class="hero" src="${API}/uploads/${esc(i.photo)}" alt="Incident photo">` : '') +
      `<div class="row"><span class="cat-tag">${ICON[i.category] || '📍'} ${esc(i.category)}</span><span class="badge s-${esc(i.status).toLowerCase()}">${esc(i.status)}</span></div>` +
      `<h2>${esc(i.title)}</h2><p class="muted">Reported ${new Date(i.created * 1000).toLocaleString()} by ${esc(i.author)}</p><p>${esc(i.description) || 'No description given.'}</p>` +
      (has ? `<h3>Location</h3><p class="muted">Latitude ${i.lat.toFixed(5)}, Longitude ${i.lng.toFixed(5)}</p>
        <iframe class="map" title="Map of the incident" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${i.lng - d}%2C${i.lat - d}%2C${i.lng + d}%2C${i.lat + d}&layer=mapnik&marker=${i.lat}%2C${i.lng}"></iframe>
        <a class="app-button" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=17/${i.lat}/${i.lng}">Open in Maps</a>` : '<p class="muted">No location was added to this report.</p>');
    $(page).on('appShow', () => { here = 'detail'; });
  });

  q('#banner').onclick = () => { q('#banner').classList.remove('show'); if (here !== 'home') App.load('home'); else if (homeReload) homeReload(); };
  document.addEventListener('backbutton', () => {
    if (here === 'home' || here === 'login') { if (navigator.app && navigator.app.exitApp) navigator.app.exitApp(); } else App.back();
  }, false);
  setInterval(poll, 20000);
  App.load(token ? 'home' : 'login');
})();
