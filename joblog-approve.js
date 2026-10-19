// joblog-approve.html: review one Job Log sign-in request from the email
// link (#<requestId>.<reviewToken>) and approve or deny it.
(function () {
  const LIVE_API = 'https://plm-rfq.precisionlasermark.workers.dev';
  // A local copy of the page may point at a local `wrangler dev` with
  // ?api=http://localhost:8787 -- never honored on the live site.
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const apiParam = new URLSearchParams(location.search).get('api');
  const API = (isLocal && apiParam) ? apiParam.replace(/\/+$/, '') : LIVE_API;

  const $ = (id) => document.getElementById(id);
  const [id, token] = location.hash.replace(/^#/, '').split('.');
  // Drop the secret from the address bar (and history) right away.
  history.replaceState(null, '', location.pathname + location.search);

  function result(text, ok) {
    $('result').textContent = text;
    $('result').className = `result ${ok ? 'ok' : 'bad'}`;
  }
  async function post(route, body) {
    const res = await fetch(API + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }
  function show(req) {
    $('card').hidden = false;
    $('code').textContent = req.code;
    $('device').textContent = req.label;
    $('access').textContent = req.scope === 'full' ? 'Job Viewer app (full access)' : 'Website board (move, count, remove)';
    $('location').textContent = `${req.location} (approximate)`;
    $('time').textContent = new Date(req.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const pending = req.status === 'pending';
    $('actions').hidden = !pending;
    $('note').hidden = !pending;
    if (req.status === 'approved' || req.status === 'claimed') result('Approved. That device is signing in now.', true);
    else if (req.status === 'denied') result('Denied. That device was not signed in.', false);
    else if (req.status === 'expired') result('This request expired. Sign in again on the device to get a new email.', false);
  }

  async function decide(decision) {
    $('approve').disabled = true;
    $('deny').disabled = true;
    const { res, data } = await post('/joblog/review/decide', { id, token, decision });
    if (data.request) show(data.request);
    if (!res.ok && !data.request) result(data.message || 'Something went wrong — try the link again.', false);
  }
  $('approve').addEventListener('click', () => decide('approve'));
  $('deny').addEventListener('click', () => decide('deny'));

  (async () => {
    if (!id || !token) { result('This link is incomplete — open it straight from the email.', false); return; }
    try {
      const { data } = await post('/joblog/review', { id, token });
      if (!data.ok) { result(data.message || 'This approval link is not valid.', false); return; }
      show(data.request);
    } catch (e) {
      result('No connection — check the internet and reload.', false);
    }
  })();
})();
