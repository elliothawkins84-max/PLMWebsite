// joblog.html: the shared Job Log board (website side). Move cards, set
// completed counts, remove jobs -- nothing else. See worker/src/joblog.js.
(function () {
  // Same Worker the site's quote form posts to. A local copy of this
  // page (served from localhost) may point at a local `wrangler dev`
  // instead with ?api=http://localhost:8787 -- never honored on the
  // live site, so a link can't redirect the password anywhere else.
  const LIVE_API = 'https://plm-rfq.precisionlasermark.workers.dev';
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const apiParam = new URLSearchParams(location.search).get('api');
  const API = (isLocal && apiParam) ? apiParam.replace(/\/+$/, '') : LIVE_API;
  const TOKEN_KEY = 'plmJoblogToken';

  const STATUSES = ['awaiting-payment', 'not-started', 'in-progress', 'done'];
  const LABELS = { 'awaiting-payment': 'Awaiting Payment', 'not-started': 'Queue', 'in-progress': 'In Progress', done: 'Done (Not Shipped)' };
  const POLL_MS = 10000;

  const $ = (id) => document.getElementById(id);
  const board = $('board');
  let jobs = [];
  let busy = 0;
  let pollTimer = null;

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ } }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
  }
  function fmtDate(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(opts.headers || {}) },
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && path !== '/joblog/login') { signedOut(); throw new Error('Signed out'); }
    if (!res.ok || data.ok === false) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  // ---- Sign in / out ----
  // A correct password doesn't sign in by itself: it sends an approval
  // email to info@ and this device waits (showing the same match code as
  // the email) until that request is approved on the review page.
  let waitTimer = null;
  let waitRequest = null;
  function signedOut() {
    setToken('');
    clearInterval(pollTimer);
    stopWaiting();
    board.hidden = true;
    $('refresh-btn').hidden = true;
    $('signout-btn').hidden = true;
    $('status').textContent = '';
    $('login').hidden = false;
    $('password').focus();
  }
  function stopWaiting() {
    clearInterval(waitTimer);
    waitTimer = null;
    waitRequest = null;
    $('waiting').hidden = true;
  }
  async function checkApproval() {
    if (!waitRequest) return;
    try {
      const res = await fetch(`${API}/joblog/login/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: waitRequest.requestId, pollSecret: waitRequest.pollSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === 'approved' && data.token) {
        stopWaiting();
        setToken(data.token);
        start();
      } else if (data.status === 'denied' || data.status === 'expired' || !data.ok) {
        stopWaiting();
        $('login').hidden = false;
        $('login-err').textContent = data.status === 'denied' ? 'The sign-in was denied.' : 'The approval request expired — sign in again.';
      } else {
        $('wait-status').textContent = 'Waiting… this page signs in by itself once approved.';
      }
    } catch (err) {
      $('wait-status').textContent = 'No connection — still waiting…';
    }
  }
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-err').textContent = 'Checking…';
    try {
      const res = await fetch(`${API}/joblog/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value, client: 'web' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pending) throw new Error(data.message || 'Could not sign in.');
      $('password').value = '';
      $('login-err').textContent = '';
      $('login').hidden = true;
      waitRequest = data;
      $('wait-code').textContent = data.code;
      $('wait-status').textContent = 'Waiting… this page signs in by itself once approved.';
      $('waiting').hidden = false;
      waitTimer = setInterval(checkApproval, 3000);
    } catch (err) {
      $('login-err').textContent = err.message;
    }
  });
  $('wait-cancel').addEventListener('click', () => { stopWaiting(); $('login').hidden = false; });
  // Signing out ends this device's session on the server too.
  $('signout-btn').addEventListener('click', async () => {
    try { await fetch(`${API}/joblog/logout`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } }); } catch (err) { /* offline: still forget it here */ }
    signedOut();
  });
  $('refresh-btn').addEventListener('click', () => load());

  // ---- Board ----
  function itemsOf(job) { return Array.isArray(job.items) && job.items.length ? job.items : null; }
  function counterRows(job) {
    const items = itemsOf(job);
    const p = job.progress || {};
    if (items) {
      const done = Array.isArray(p.items) ? p.items : [];
      // The first item picks up an older single "Front" count, same as the app.
      return items.map((it, i) => ({ side: `item-${i}`, label: it.label, max: it.quantity, value: done[i] != null ? done[i] : (i === 0 ? p.front || 0 : 0) }));
    }
    const rows = [{ side: 'front', label: 'Front', max: job.quantity, value: p.front || 0 }];
    if (job.hasBack) rows.push({ side: 'back', label: 'Back', max: job.quantity, value: p.back || 0 });
    return rows;
  }
  function cardHTML(job) {
    const items = itemsOf(job);
    const qtyBit = items && items.length > 1 ? `${items.length} items` : `Qty ${(items ? items[0].quantity : job.quantity) || 'n/a'}`;
    const meta = [job.cardTypeLabel, qtyBit].filter(Boolean).join(' · ');
    const hist = [['Logged', job.addedAt], ['Paid', job.paidAt], ['Started', job.startedAt], ['Complete', job.completedAt]]
      .filter(([, iso]) => iso).map(([l, iso]) => `<div class="card-hist">${l}: ${esc(fmtDate(iso))}</div>`).join('');
    const progress = job.status === 'in-progress' ? `
      <div class="progress">
        ${counterRows(job).map((r) => `
          <div class="prow${r.side.startsWith('item-') ? ' is-item' : ''}" data-side="${esc(r.side)}" data-max="${r.max || 0}">
            <span class="prow-label" title="${esc(r.label)}">${esc(r.label)}</span>
            <button type="button" class="step" data-step="-1" aria-label="One less">−</button>
            <input type="number" inputmode="numeric" min="0" ${r.max ? `max="${r.max}"` : ''} value="${r.value}" aria-label="${esc(r.label)} completed" />
            <button type="button" class="step" data-step="1" aria-label="One more">+</button>
            <span class="prow-of">/ ${r.max || '?'}</span>
          </div>`).join('')}
      </div>` : '';
    return `
      <div class="card" draggable="true" data-id="${esc(job.id)}">
        <button type="button" class="card-remove" title="Remove from log" aria-label="Remove from log">×</button>
        ${job.thumbnail ? `<img class="card-thumb" src="${esc(job.thumbnail)}" alt="" />` : ''}
        <div class="card-title">${esc(job.orderName || job.filename || 'Untitled job')}</div>
        <div class="card-meta">${esc(meta)}</div>
        ${hist}
        ${progress}
        <label class="move">Move to
          <select>${STATUSES.map((s) => `<option value="${s}"${s === job.status ? ' selected' : ''}>${LABELS[s]}</option>`).join('')}</select>
        </label>
      </div>`;
  }
  function render() {
    board.innerHTML = STATUSES.map((s) => {
      const inCol = jobs.filter((j) => j.status === s);
      return `
        <section class="col" data-status="${s}">
          <div class="col-head"><span>${LABELS[s]}</span><span class="col-count">${inCol.length}</span></div>
          <div class="col-body">${inCol.length ? inCol.map(cardHTML).join('') : '<div class="empty">No jobs</div>'}</div>
        </section>`;
    }).join('');
  }
  async function load() {
    if (busy) return;
    try {
      const data = await api('/joblog/jobs');
      // Don't redraw underneath someone typing into a counter.
      if (busy || board.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      jobs = data.jobs;
      render();
      $('status').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) {
      if (err.message !== 'Signed out') $('status').textContent = 'Offline — retrying…';
    }
  }
  // Applies a change on screen immediately, sends it, then takes the
  // server's copy of that job (which has the clamped counts / new
  // timestamps). On failure, reloads the board so it never shows a
  // change that didn't actually save.
  async function change(id, method, body) {
    busy++;
    try {
      const data = await api(`/joblog/jobs/${encodeURIComponent(id)}`, { method, body: body ? JSON.stringify(body) : undefined });
      if (method === 'DELETE') jobs = jobs.filter((j) => j.id !== id);
      else jobs = jobs.map((j) => (j.id === id ? data.job : j));
    } catch (err) {
      if (err.message !== 'Signed out') toast(`Not saved: ${err.message}`);
      busy--; await load(); return;
    }
    busy--;
    render();
  }
  function jobFor(el) { const card = el.closest('.card'); return card ? jobs.find((j) => j.id === card.dataset.id) : null; }

  board.addEventListener('click', (e) => {
    const job = jobFor(e.target);
    if (!job) return;
    if (e.target.closest('.card-remove')) {
      if (confirm(`Remove "${job.orderName || job.filename || 'this job'}" from the log?`)) change(job.id, 'DELETE');
      return;
    }
    const step = e.target.closest('.step');
    if (step) {
      const row = step.closest('.prow');
      const input = row.querySelector('input');
      const max = Number(row.dataset.max) || Infinity;
      const next = Math.max(0, Math.min(max, (Number(input.value) || 0) + Number(step.dataset.step)));
      input.value = next;
      change(job.id, 'PATCH', { side: row.dataset.side, value: next });
    }
  });
  board.addEventListener('change', (e) => {
    const job = jobFor(e.target);
    if (!job) return;
    if (e.target.tagName === 'SELECT') {
      change(job.id, 'PATCH', { status: e.target.value });
    } else if (e.target.tagName === 'INPUT') {
      change(job.id, 'PATCH', { side: e.target.closest('.prow').dataset.side, value: Number(e.target.value) || 0 });
    }
  });
  // Drag a card onto another column (mouse); phones use the "Move to" menu.
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('input, select, button')) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => card.classList.add('is-dragging'));
  });
  board.addEventListener('dragend', (e) => { const c = e.target.closest && e.target.closest('.card'); if (c) c.classList.remove('is-dragging'); });
  board.addEventListener('dragover', (e) => {
    const body = e.target.closest('.col-body');
    if (!body) return;
    e.preventDefault();
    board.querySelectorAll('.col-body.is-over').forEach((b) => b !== body && b.classList.remove('is-over'));
    body.classList.add('is-over');
  });
  board.addEventListener('dragleave', (e) => { const body = e.target.closest('.col-body'); if (body && !body.contains(e.relatedTarget)) body.classList.remove('is-over'); });
  board.addEventListener('drop', (e) => {
    const body = e.target.closest('.col-body');
    if (!body) return;
    e.preventDefault();
    body.classList.remove('is-over');
    const id = e.dataTransfer.getData('text/plain');
    const status = body.closest('.col').dataset.status;
    const job = jobs.find((j) => j.id === id);
    if (job && job.status !== status) change(id, 'PATCH', { status });
  });

  function start() {
    $('login').hidden = true;
    board.hidden = false;
    $('refresh-btn').hidden = false;
    $('signout-btn').hidden = false;
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && getToken()) load(); });

  if (getToken()) start(); else signedOut();
})();
