// Shared Job Log API -- the one copy of the shop's job board that both the
// PLM Job Viewer desktop app and the hidden website page (joblog.html)
// read and write, so a change on any device shows up on every other.
//
// Board rows live in D1 (env.JOBLOG_DB, see migrations/); each job's full
// .plmj payload lives in KV (env.JOBLOG_KV, key "payload:<id>") since it
// can run to megabytes and the board never needs it -- only the desktop
// app fetches it, to reopen a job.
//
// Signing in takes two things: the password (Worker secret
// JOBLOG_PASSWORD) AND approval by email. A correct password only opens a
// login request; an email goes to info@ with a link to a review page
// (joblog-approve.html) where the request is approved or denied. The
// waiting device polls with its own secret and, once approved, receives a
// random session token. Only SHA-256 hashes of every secret are stored.
//
// Two kinds of session:
//   'board' -- the website page: see the board, move cards, set counters,
//              remove jobs. Nothing else (no full job details, no adding).
//   'full'  -- the desktop app: everything, plus the approved-devices list.
//
// Changes are per job and per field (move one card, set one counter),
// not "save the whole board", so two devices editing different jobs at
// the same time never overwrite each other.

const STATUSES = ['awaiting-payment', 'not-started', 'in-progress', 'done'];
// Which stage-reached timestamp a move into each column stamps (same rule
// the desktop app always used): re-stamped on every move into it.
const STAGE_FIELD = { 'not-started': 'paid_at', 'in-progress': 'started_at', done: 'completed_at' };
const SESSION_DAYS = { board: 30, full: 180 };
const REQUEST_MINUTES = 15;
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_CHARS = 400 * 1024;
const LAST_SEEN_EVERY_MS = 10 * 60 * 1000;
// How long a removed job's final dates stay available for the Macs that
// hold its .plmj to pick up (see the removed_jobs table).
const REMOVED_KEEP_DAYS = 90;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const APPROVE_PAGE = 'https://precisionlasermark.com/joblog-approve';
const ALERT_TO = 'info@precisionlasermark.com';
const ALERT_FROM = 'PLM Job Log <joblog@mail.precisionlasermark.com>';

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}
// Compares via hashes of both sides, so the time taken doesn't depend on
// how many leading characters matched.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < ha.length && i < hb.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
function matchCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Chrome on iPhone" etc. from the browser's own description of itself.
function describeBrowser(ua) {
  ua = ua || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}
function describeLocation(request) {
  const cf = request.cf || {};
  return [cf.city, cf.region, cf.country].filter(Boolean).join(', ') || 'Unknown location';
}

async function sendApprovalEmail(env, req, reviewToken) {
  const link = `${APPROVE_PAGE}#${req.id}.${reviewToken}`;
  // Local testing only (set in worker/.dev.vars, never on the live
  // Worker): print the link instead of emailing it.
  if (env.JOBLOG_DEV_LOG_EMAIL === '1') {
    console.log(`[joblog dev] approval link for ${req.label} (code ${req.code}): ${link}`);
    return true;
  }
  const when = new Date(req.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
  const kind = req.scope === 'full' ? 'the Job Viewer app' : 'the website Job Log';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [ALERT_TO],
      subject: `Job Log sign-in request — code ${req.code}`,
      html: `<p>Someone entered the correct Job Log password and is waiting for approval to sign in to ${escapeHtml(kind)}.</p>
<table cellpadding="4" style="border-collapse:collapse">
<tr><td><strong>Match code</strong></td><td style="font-size:20px;letter-spacing:3px"><strong>${escapeHtml(req.code)}</strong></td></tr>
<tr><td><strong>Device</strong></td><td>${escapeHtml(req.label)}</td></tr>
<tr><td><strong>Location</strong></td><td>${escapeHtml(req.location)} (approximate)</td></tr>
<tr><td><strong>Time</strong></td><td>${escapeHtml(when)} Pacific</td></tr>
</table>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Review request</a></p>
<p>Only approve if the code above matches the one showing on the device you're signing in on. The request expires in ${REQUEST_MINUTES} minutes.</p>
<p><strong>If this wasn't you,</strong> deny it — someone has the Job Log password. Change it as soon as possible.</p>`,
    }),
  });
  if (!res.ok) console.error('Resend error (joblog approval):', res.status);
  return res.ok;
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
// The website's board never needs where a job's file sits on some Mac.
function forScope(job, scope) {
  if (scope === 'full') return job;
  const { filePath, ...rest } = job;
  return rest;
}
async function getRow(env, id) {
  return env.JOBLOG_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
}
// The board-summary fields a client may set when adding/updating a job.
// Status, progress and timestamps are only ever changed through their own
// routes below.
function summaryColumns(body) {
  const items = Array.isArray(body.items)
    ? JSON.stringify(body.items.slice(0, 200).map((it) => ({ label: String(it.label || '').slice(0, 200), quantity: Math.max(0, Math.round(Number(it.quantity) || 0)) })))
    : null;
  const thumb = typeof body.thumbnail === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.thumbnail) && body.thumbnail.length <= MAX_THUMB_CHARS
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
const isoOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// The session behind a request's Bearer token, or null.
async function sessionFor(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 200) return null;
  const s = await env.JOBLOG_DB.prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0').bind(await sha256(token)).first();
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > LAST_SEEN_EVERY_MS) {
    await env.JOBLOG_DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), s.id).run();
  }
  return s;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export async function handleJoblog(request, env, url, json) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (!env.JOBLOG_DB || !env.JOBLOG_KV || !env.JOBLOG_PASSWORD || !env.RESEND_API_KEY) {
    return json({ ok: false, message: 'Job log is not set up on the server yet.' }, 503);
  }

  // ---- Sign-in, step 1: password -> login request + approval email ----
  if (path === '/joblog/login' && method === 'POST') {
    if (env.LOGIN_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
      if (!success) return json({ ok: false, message: 'Too many tries — wait a minute and try again.' }, 429);
    }
    const body = (await readJson(request)) || {};
    // A wrong password sends no email, so guessing can't flood info@.
    if (!(await safeEqual(body.password || '', env.JOBLOG_PASSWORD))) {
      return json({ ok: false, message: 'Wrong password.' }, 401);
    }
    const scope = body.client === 'app' ? 'full' : 'board';
    const deviceName = String(body.deviceName || '').replace(/[^\w .'’-]/g, '').slice(0, 60);
    const label = scope === 'full'
      ? `PLM Job Viewer${deviceName ? ` on ${deviceName}` : ' (Mac app)'}`
      : describeBrowser(request.headers.get('User-Agent'));
    const pollSecret = randomToken();
    const reviewToken = randomToken();
    const req = {
      id: randomToken(12),
      code: matchCode(),
      scope,
      label,
      location: describeLocation(request),
      created_at: new Date().toISOString(),
      expires_at: isoIn(REQUEST_MINUTES * 60 * 1000),
    };
    await env.JOBLOG_DB.prepare("DELETE FROM login_requests WHERE created_at < ?").bind(isoIn(-24 * 60 * 60 * 1000)).run();
    await env.JOBLOG_DB.prepare(`INSERT INTO login_requests (id, code, scope, label, location, poll_hash, review_hash, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .bind(req.id, req.code, req.scope, req.label, req.location, await sha256(pollSecret), await sha256(reviewToken), req.created_at, req.expires_at)
      .run();
    if (!(await sendApprovalEmail(env, req, reviewToken))) {
      return json({ ok: false, message: 'Could not send the approval email — try again in a minute.' }, 502);
    }
    return json({ ok: true, pending: true, requestId: req.id, pollSecret, code: req.code, expiresAt: req.expires_at }, 200);
  }

  // ---- Sign-in, step 2: the waiting device polls; on approval it gets
  // its session token (exactly once). ----
  if (path === '/joblog/login/status' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const req = await env.JOBLOG_DB.prepare('SELECT * FROM login_requests WHERE id = ?').bind(String(body.requestId || '')).first();
    if (!req || !(await safeEqual(await sha256(body.pollSecret || ''), req.poll_hash))) {
      return json({ ok: false, message: 'Unknown sign-in request.' }, 404);
    }
    if (req.status === 'denied') return json({ ok: true, status: 'denied' }, 200);
    if (req.status === 'claimed') return json({ ok: true, status: 'expired' }, 200);
    if (req.status === 'pending') {
      return json({ ok: true, status: Date.parse(req.expires_at) < Date.now() ? 'expired' : 'pending' }, 200);
    }
    // approved -> hand over a session, once.
    const claim = await env.JOBLOG_DB.prepare("UPDATE login_requests SET status = 'claimed' WHERE id = ? AND status = 'approved'").bind(req.id).run();
    if (!claim.meta || claim.meta.changes !== 1) return json({ ok: true, status: 'expired' }, 200);
    const token = randomToken();
    const now = new Date().toISOString();
    await env.JOBLOG_DB.prepare(`INSERT INTO sessions (id, token_hash, scope, label, location, created_at, expires_at, last_seen_at, revoked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .bind(randomToken(12), await sha256(token), req.scope, req.label, req.location, now, isoIn(SESSION_DAYS[req.scope] * 24 * 60 * 60 * 1000), now)
      .run();
    return json({ ok: true, status: 'approved', token, scope: req.scope }, 200);
  }

  // ---- The review page (from the email link): look up / decide ----
  if ((path === '/joblog/review' || path === '/joblog/review/decide') && method === 'POST') {
    const body = (await readJson(request)) || {};
    const req = await env.JOBLOG_DB.prepare('SELECT * FROM login_requests WHERE id = ?').bind(String(body.id || '')).first();
    if (!req || !(await safeEqual(await sha256(body.token || ''), req.review_hash))) {
      return json({ ok: false, message: 'This approval link is not valid.' }, 404);
    }
    const expired = Date.parse(req.expires_at) < Date.now();
    const info = { code: req.code, label: req.label, location: req.location, createdAt: req.created_at, scope: req.scope,
      status: req.status === 'pending' && expired ? 'expired' : req.status };
    if (path === '/joblog/review') return json({ ok: true, request: info }, 200);
    if (req.status !== 'pending' || expired) return json({ ok: false, message: 'This request was already handled or has expired.', request: info }, 409);
    const decision = body.decision === 'approve' ? 'approved' : 'denied';
    await env.JOBLOG_DB.prepare("UPDATE login_requests SET status = ? WHERE id = ? AND status = 'pending'").bind(decision, req.id).run();
    return json({ ok: true, request: { ...info, status: decision } }, 200);
  }

  // ---- Everything below needs an approved session ----
  const session = await sessionFor(env, request);
  if (!session) return json({ ok: false, message: 'Not signed in.' }, 401);
  const full = session.scope === 'full';
  const fullOnly = () => json({ ok: false, message: 'Not allowed from the website.' }, 403);

  // Sign this device out.
  if (path === '/joblog/logout' && method === 'POST') {
    await env.JOBLOG_DB.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(session.id).run();
    return json({ ok: true }, 200);
  }

  // Approved devices (desktop app only): list, and sign one out.
  if (path === '/joblog/sessions' && method === 'GET') {
    if (!full) return fullOnly();
    const { results } = await env.JOBLOG_DB.prepare('SELECT * FROM sessions WHERE revoked = 0 AND expires_at > ? ORDER BY created_at DESC')
      .bind(new Date().toISOString()).all();
    return json({ ok: true, sessions: results.map((s) => ({
      id: s.id, label: s.label, location: s.location, scope: s.scope, approvedAt: s.created_at,
      lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, current: s.id === session.id,
    })) }, 200);
  }
  const sm = /^\/joblog\/sessions\/([^/]+)$/.exec(path);
  if (sm && method === 'DELETE') {
    if (!full) return fullOnly();
    await env.JOBLOG_DB.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(decodeURIComponent(sm[1])).run();
    return json({ ok: true }, 200);
  }

  // GET /joblog/jobs -- the whole board (no payloads). The desktop app
  // also gets the recently removed jobs' final dates, to write into their
  // .plmj files.
  if (path === '/joblog/jobs' && method === 'GET') {
    const { results } = await env.JOBLOG_DB.prepare('SELECT * FROM jobs ORDER BY added_at ASC').all();
    const out = { ok: true, jobs: results.map((r) => forScope(rowToJob(r), session.scope)) };
    if (full) {
      const removed = await env.JOBLOG_DB.prepare('SELECT * FROM removed_jobs WHERE removed_at > ? ORDER BY seq ASC')
        .bind(isoIn(-REMOVED_KEEP_DAYS * 24 * 60 * 60 * 1000)).all();
      out.removed = removed.results.map((r) => ({
        id: r.job_id, filename: r.filename, filePath: r.file_path, removedAt: r.removed_at,
        addedAt: r.added_at, paidAt: r.paid_at, startedAt: r.started_at, completedAt: r.completed_at,
      }));
    }
    return json(out, 200);
  }

  // POST /joblog/jobs -- add a job (desktop app only). Adding one that's
  // already there reports it and leaves its column/progress alone. The
  // one-time upload of an app's old local log may carry its own
  // status/progress/timestamps.
  if (path === '/joblog/jobs' && method === 'POST') {
    if (!full) return fullOnly();
    const body = await readJson(request);
    if (!body) return json({ ok: false, message: 'Bad request.' }, 400);
    const id = String(body.id || '');
    if (!id || id.length > 500) return json({ ok: false, message: 'Missing job id.' }, 400);
    const existing = await getRow(env, id);
    if (existing) return json({ ok: true, added: false, job: rowToJob(existing) }, 200);
    if (!(await putPayload(env, id, body.payload))) return json({ ok: false, message: 'Job file too large.' }, 413);
    const now = new Date().toISOString();
    const s = summaryColumns(body);
    const status = STATUSES.includes(body.status) ? body.status : 'awaiting-payment';
    const progress = body.progress && typeof body.progress === 'object' ? JSON.stringify(body.progress).slice(0, 20000) : '{"front":0,"back":0}';
    await env.JOBLOG_DB.prepare(`INSERT INTO jobs (id, filename, file_path, order_name, quantity, items, card_type_label, has_back, thumbnail,
        status, progress, added_at, updated_at, paid_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, String(body.filename || '').slice(0, 500), body.filePath ? String(body.filePath).slice(0, 2000) : null,
        s.order_name, s.quantity, s.items, s.card_type_label, s.has_back, s.thumbnail,
        status, progress, isoOrNull(body.addedAt) || now, now, isoOrNull(body.paidAt), isoOrNull(body.startedAt), isoOrNull(body.completedAt))
      .run();
    return json({ ok: true, added: true, job: rowToJob(await getRow(env, id)) }, 200);
  }

  const m = /^\/joblog\/jobs\/([^/]+)(\/payload)?$/.exec(path);
  if (!m) return json({ ok: false, message: 'Not found.' }, 404);
  const id = decodeURIComponent(m[1]);

  // GET /joblog/jobs/:id/payload -- the full job, for reopening it
  // (desktop app only: this is where customer contact details live).
  if (m[2]) {
    if (!full) return fullOnly();
    if (method !== 'GET') return json({ ok: false, message: 'Method not allowed.' }, 405);
    const text = await env.JOBLOG_KV.get(`payload:${id}`);
    if (text == null) return json({ ok: false, message: 'No saved job file.' }, 404);
    return new Response(`{"ok":true,"payload":${text}}`, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const row = await getRow(env, id);
  if (!row) return json({ ok: false, message: 'That job is no longer in the log.' }, 404);

  if (method === 'DELETE') {
    const now = new Date().toISOString();
    await env.JOBLOG_DB.batch([
      env.JOBLOG_DB.prepare(`INSERT INTO removed_jobs (job_id, filename, file_path, added_at, paid_at, started_at, completed_at, removed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.id, row.filename, row.file_path, row.added_at, row.paid_at, row.started_at, row.completed_at, now),
      env.JOBLOG_DB.prepare('DELETE FROM jobs WHERE id = ?').bind(id),
      env.JOBLOG_DB.prepare('DELETE FROM removed_jobs WHERE removed_at < ?').bind(isoIn(-REMOVED_KEEP_DAYS * 24 * 60 * 60 * 1000)),
    ]);
    await env.JOBLOG_KV.delete(`payload:${id}`);
    return json({ ok: true }, 200);
  }

  const body = await readJson(request);
  if (!body) return json({ ok: false, message: 'Bad request.' }, 400);
  const now = new Date().toISOString();

  // PUT /joblog/jobs/:id -- the job was edited in the app: new summary
  // and payload; column/progress/timestamps untouched.
  if (method === 'PUT') {
    if (!full) return fullOnly();
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
      const itemMatch = /^item-(\d{1,3})$/.exec(side);
      if (side !== 'front' && side !== 'back' && !itemMatch) return json({ ok: false, message: 'Unknown counter.' }, 400);
      const items = row.items ? JSON.parse(row.items) : [];
      const item = itemMatch ? items[Number(itemMatch[1])] : null;
      if (itemMatch && !item) return json({ ok: false, message: 'Unknown item.' }, 400);
      const limit = item ? item.quantity : row.quantity;
      const n = Math.round(Number(body.value));
      const clamped = Number.isFinite(n) ? Math.max(0, Math.min(limit > 0 ? limit : 1000000, n)) : 0;
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
    return json({ ok: true, job: forScope(rowToJob(await getRow(env, id)), session.scope) }, 200);
  }

  return json({ ok: false, message: 'Method not allowed.' }, 405);
}
