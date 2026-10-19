// Shared Job Log API -- the one copy of the shop's job board that both the
// PLM Job Viewer desktop app and the hidden website page (joblog.html)
// read and write, so a change on any device shows up on every other.
//
// Board rows live in D1 (env.JOBLOG_DB, see migrations/0001_joblog.sql);
// each job's full .plmj payload lives in KV (env.JOBLOG_KV, key
// "payload:<id>") since it can run to megabytes and the board never needs
// it -- only the desktop app fetches it, to reopen a job.
//
// Every route except /joblog/login needs a token from /joblog/login,
// checked here on the server -- the password itself (JOBLOG_PASSWORD) and
// the token-signing key (JOBLOG_SECRET) are Worker secrets, never in the
// page or the app.
//
// Changes are per job and per field (move one card, set one counter),
// not "save the whole board", so two devices editing different jobs at
// the same time never overwrite each other.

const STATUSES = ['awaiting-payment', 'not-started', 'in-progress', 'done'];
// Which stage-reached timestamp a move into each column stamps (same rule
// the desktop app always used): re-stamped on every move into it.
const STAGE_FIELD = { 'not-started': 'paid_at', 'in-progress': 'started_at', done: 'completed_at' };
const TOKEN_DAYS = 180;
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_CHARS = 400 * 1024;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
// Constant-time-ish compare via hashing both sides first, so the time
// taken doesn't depend on how many leading characters matched.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function makeToken(env) {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  return `${exp}.${await hmac(env.JOBLOG_SECRET, `joblog:${exp}`)}`;
}
async function checkToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, await hmac(env.JOBLOG_SECRET, `joblog:${exp}`));
}

function rowToJob(r) {
  return {
    id: r.id,
    filename: r.filename,
    filePath: r.file_path,
    orderName: r.order_name || '',
    quantity: r.quantity || 0,
    items: r.items ? JSON.parse(r.items) : undefined,
    cardTypeLabel: r.card_type_label || '',
    hasBack: !!r.has_back,
    thumbnail: r.thumbnail || null,
    status: r.status,
    progress: JSON.parse(r.progress || '{}'),
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    paidAt: r.paid_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}
async function getRow(env, id) {
  return env.JOBLOG_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
}
// The board-summary fields a client may set when adding/updating a job.
// Status, progress and timestamps are only ever changed through their own
// routes below.
function summaryColumns(body) {
  const items = Array.isArray(body.items)
    ? JSON.stringify(body.items.map((it) => ({ label: String(it.label || '').slice(0, 200), quantity: Math.max(0, Math.round(Number(it.quantity) || 0)) })))
    : null;
  const thumb = typeof body.thumbnail === 'string' && body.thumbnail.startsWith('data:image/') && body.thumbnail.length <= MAX_THUMB_CHARS
    ? body.thumbnail : null;
  return {
    order_name: String(body.orderName || '').slice(0, 300),
    quantity: Math.max(0, Math.round(Number(body.quantity) || 0)),
    items,
    card_type_label: String(body.cardTypeLabel || '').slice(0, 300),
    has_back: body.hasBack ? 1 : 0,
    thumbnail: thumb,
  };
}
async function putPayload(env, id, payload) {
  if (payload === undefined) return true;
  const text = JSON.stringify(payload);
  if (text.length > MAX_PAYLOAD_BYTES) return false;
  await env.JOBLOG_KV.put(`payload:${id}`, text);
  return true;
}

export async function handleJoblog(request, env, url, json) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (!env.JOBLOG_DB || !env.JOBLOG_KV || !env.JOBLOG_PASSWORD || !env.JOBLOG_SECRET) {
    return json({ ok: false, message: 'Job log is not set up on the server yet.' }, 503);
  }

  if (path === '/joblog/login' && method === 'POST') {
    if (env.LOGIN_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
      if (!success) return json({ ok: false, message: 'Too many tries — wait a minute and try again.' }, 429);
    }
    let body;
    try { body = await request.json(); } catch { body = {}; }
    if (!(await safeEqual(body.password || '', env.JOBLOG_PASSWORD))) {
      return json({ ok: false, message: 'Wrong password.' }, 401);
    }
    return json({ ok: true, token: await makeToken(env) }, 200);
  }

  if (!(await checkToken(env, request))) {
    return json({ ok: false, message: 'Not signed in.' }, 401);
  }

  // GET /joblog/jobs -- the whole board (no payloads).
  if (path === '/joblog/jobs' && method === 'GET') {
    const { results } = await env.JOBLOG_DB.prepare('SELECT * FROM jobs ORDER BY added_at ASC').all();
    return json({ ok: true, jobs: results.map(rowToJob) }, 200);
  }

  // POST /joblog/jobs -- add a job (desktop app only; the website page has
  // no way to call this). Adding one that's already there reports it and
  // leaves its column/progress alone. A migration upload may carry its own
  // status/progress/timestamps from the app's old local log.
  if (path === '/joblog/jobs' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, message: 'Bad request.' }, 400); }
    const id = String(body.id || '');
    if (!id || id.length > 500) return json({ ok: false, message: 'Missing job id.' }, 400);
    const existing = await getRow(env, id);
    if (existing) return json({ ok: true, added: false, job: rowToJob(existing) }, 200);
    if (!(await putPayload(env, id, body.payload))) return json({ ok: false, message: 'Job file too large.' }, 413);
    const now = new Date().toISOString();
    const s = summaryColumns(body);
    const status = STATUSES.includes(body.status) ? body.status : 'awaiting-payment';
    const progress = body.progress && typeof body.progress === 'object' ? JSON.stringify(body.progress) : '{"front":0,"back":0}';
    await env.JOBLOG_DB.prepare(`INSERT INTO jobs (id, filename, file_path, order_name, quantity, items, card_type_label, has_back, thumbnail,
        status, progress, added_at, updated_at, paid_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, String(body.filename || '').slice(0, 500), body.filePath ? String(body.filePath).slice(0, 2000) : null,
        s.order_name, s.quantity, s.items, s.card_type_label, s.has_back, s.thumbnail,
        status, progress, body.addedAt || now, now, body.paidAt || null, body.startedAt || null, body.completedAt || null)
      .run();
    return json({ ok: true, added: true, job: rowToJob(await getRow(env, id)) }, 200);
  }

  const m = /^\/joblog\/jobs\/([^/]+)(\/payload)?$/.exec(path);
  if (!m) return json({ ok: false, message: 'Not found.' }, 404);
  const id = decodeURIComponent(m[1]);

  // GET /joblog/jobs/:id/payload -- the full job, for reopening it.
  if (m[2]) {
    if (method !== 'GET') return json({ ok: false, message: 'Method not allowed.' }, 405);
    const text = await env.JOBLOG_KV.get(`payload:${id}`);
    if (text == null) return json({ ok: false, message: 'No saved job file.' }, 404);
    return new Response(`{"ok":true,"payload":${text}}`, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const row = await getRow(env, id);
  if (!row) return json({ ok: false, message: 'That job is no longer in the log.' }, 404);

  if (method === 'DELETE') {
    await env.JOBLOG_DB.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
    await env.JOBLOG_KV.delete(`payload:${id}`);
    return json({ ok: true }, 200);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, message: 'Bad request.' }, 400); }
  const now = new Date().toISOString();

  // PUT /joblog/jobs/:id -- the job was edited in the app: new summary
  // and payload; column/progress/timestamps untouched.
  if (method === 'PUT') {
    if (!(await putPayload(env, id, body.payload))) return json({ ok: false, message: 'Job file too large.' }, 413);
    const s = summaryColumns(body);
    await env.JOBLOG_DB.prepare(`UPDATE jobs SET order_name = ?, quantity = ?, items = ?, card_type_label = ?, has_back = ?,
        thumbnail = COALESCE(?, thumbnail), filename = COALESCE(?, filename), file_path = COALESCE(?, file_path), updated_at = ? WHERE id = ?`)
      .bind(s.order_name, s.quantity, s.items, s.card_type_label, s.has_back, s.thumbnail,
        body.filename ? String(body.filename).slice(0, 500) : null, body.filePath ? String(body.filePath).slice(0, 2000) : null, now, id)
      .run();
    return json({ ok: true, job: rowToJob(await getRow(env, id)) }, 200);
  }

  // PATCH /joblog/jobs/:id -- {status} (move a card) or {side, value}
  // (set one progress counter: 'front', 'back' or 'item-<n>', clamped to
  // that line's quantity).
  if (method === 'PATCH') {
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json({ ok: false, message: 'Unknown column.' }, 400);
      if (body.status !== row.status) {
        const field = STAGE_FIELD[body.status];
        await env.JOBLOG_DB.prepare(`UPDATE jobs SET status = ?, updated_at = ?${field ? `, ${field} = ?` : ''} WHERE id = ?`)
          .bind(...(field ? [body.status, now, now, id] : [body.status, now, id])).run();
      }
    } else if (body.side !== undefined) {
      const side = String(body.side);
      const itemMatch = /^item-(\d+)$/.exec(side);
      if (side !== 'front' && side !== 'back' && !itemMatch) return json({ ok: false, message: 'Unknown counter.' }, 400);
      const items = row.items ? JSON.parse(row.items) : [];
      const item = itemMatch ? items[Number(itemMatch[1])] : null;
      if (itemMatch && !item) return json({ ok: false, message: 'Unknown item.' }, 400);
      const limit = item ? item.quantity : row.quantity;
      const n = Math.round(Number(body.value));
      const clamped = Number.isFinite(n) ? Math.max(0, limit > 0 ? Math.min(limit, n) : n) : 0;
      const progress = JSON.parse(row.progress || '{}');
      if (item) {
        if (!Array.isArray(progress.items)) progress.items = [];
        progress.items[Number(itemMatch[1])] = clamped;
      } else {
        progress[side] = clamped;
      }
      await env.JOBLOG_DB.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(progress), now, id).run();
    } else {
      return json({ ok: false, message: 'Nothing to change.' }, 400);
    }
    return json({ ok: true, job: rowToJob(await getRow(env, id)) }, 200);
  }

  return json({ ok: false, message: 'Method not allowed.' }, 405);
}
