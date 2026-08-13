const ALLOWED_ORIGINS = new Set([
  'https://precisionlasermark.com',
  'https://www.precisionlasermark.com',
]);

const TO_EMAIL = 'info@precisionlasermark.com';
const FROM_EMAIL = 'RFQ Form <rfq@mail.precisionlasermark.com>';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB, matches the site's stated limit

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ success: false, message: 'Method not allowed' }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ success: false, message: 'Forbidden' }, 403, origin);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ success: false, message: 'Invalid form submission' }, 400, origin);
    }

    // Honeypot: bots tend to fill every field. If this hidden field has a
    // value, silently report success without sending anything.
    if (form.get('company')) {
      return json({ success: true }, 200, origin);
    }

    const name = (form.get('name') || '').toString().trim();
    const email = (form.get('email') || '').toString().trim();
    const message = (form.get('message') || '').toString().trim();

    if (!name || !email || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, message: 'Please fill in all fields with a valid email.' }, 400, origin);
    }

    const attachments = [];
    let totalBytes = 0;
    for (const value of form.getAll('attachment')) {
      if (value instanceof File && value.size > 0) {
        totalBytes += value.size;
        if (totalBytes > MAX_ATTACHMENT_BYTES) {
          return json({ success: false, message: 'Attachments too large — 10MB total max.' }, 400, origin);
        }
        attachments.push({ filename: value.name, content: await fileToBase64(value) });
      }
    }

    const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: email,
        subject: `New RFQ from ${name} — precisionlasermark.com`,
        html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Project details:</strong></p>
<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
        attachments: attachments.length ? attachments : undefined,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      return json({ success: false, message: 'Failed to send — please try again.' }, 502, origin);
    }

    return json({ success: true }, 200, origin);
  },
};
