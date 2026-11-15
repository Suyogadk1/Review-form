import { template, rows, selection, browserScript } from './packet.mjs';

const repository = 'Suyogadk1/Review-form';
const workflowRef = repository + '/.github/workflows/sync-ratings.yml@refs/heads/main';
const issuer = 'https://token.actions.githubusercontent.com';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex64 = /^[a-f0-9]{64}$/;
const validLabels = new Set(['safe', 'unsafe', 'uncertain']);
const rowById = new Map(rows.map(row => [row.response_id, row]));
const { dataset_sha256: digest, shared_high, shared_medium, high, medium } = selection;

const entry = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MindCare review form</title><h1>MindCare review form</h1>
<p id="status" role="status">Opening your 15-item form…</p>
<script>
const key = location.hash.slice(1);
if (key) history.replaceState(null, '', '/');
async function enter() {
  const result = await fetch('/enter', {method: 'POST', headers: {Authorization: 'Bearer ' + key}});
  if (!result.ok) throw new Error(result.status === 401
    ? 'Open the full reviewer link you received.'
    : 'The form could not be opened. Try again in a moment.');
  location.replace('/packet');
}
enter().catch(error => document.querySelector('#status').textContent = error.message);
</script></html>`;

function response(body, status = 200, type = 'text/plain; charset=utf-8', extra = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'no-store',
    'Content-Type': type,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  } });
}

function json(body) {
  return response(JSON.stringify(body), 200, 'application/json; charset=utf-8');
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function sessionCookie(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-mindcare=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function lookup(request, db) {
  const session = sessionCookie(request);
  if (!session) return null;
  return db.prepare('SELECT id, ids FROM assignments WHERE session = ?').bind(await hash(session)).first();
}

function sample(items, n) {
  const available = [...items];
  const random = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(random, number => available.splice(Math.floor(number / 2 ** 32 * available.length), 1)[0]);
}

async function enter(request, env) {
  const key = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!key || !env.ACCESS_KEY || !crypto.subtle.timingSafeEqual(encoder.encode(key), encoder.encode(env.ACCESS_KEY))) {
    return response('Open the full reviewer link you received.', 401);
  }
  let session = sessionCookie(request);
  if (!await lookup(request, env.DB)) {
    session = hex(crypto.getRandomValues(new Uint8Array(32)));
    const sessionHash = await hash(session);
    for (let attempt = 0; ; attempt++) {
      if (attempt === 32) return response('Could not reserve a form. Try again in a moment.', 503);
      const ids = sample([...shared_high, ...shared_medium, ...sample(high, 6), ...sample(medium, 5)], 15);
      const id = await hash(JSON.stringify([digest, ...[...ids].sort()]));
      const inserted = await env.DB.prepare('INSERT OR IGNORE INTO assignments (id, session, ids) VALUES (?, ?, ?)')
        .bind(id, sessionHash, JSON.stringify(ids)).run();
      if (inserted.meta.changes === 1) break;
    }
  }
  return response(null, 204, undefined, {
    'Set-Cookie': `__Host-mindcare=${session}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
  });
}

function form(assignment) {
  const data = JSON.stringify(JSON.parse(assignment.ids).map(id => rowById.get(id))).replace(/</g, '\\u003c');
  return template.replace('/*ASSIGNED_ROWS*/[]', () => data).replace('</body>',
    `<script>const submissionRepository = ${JSON.stringify(repository)}; const submissionQueued = true;</script><script src="/submit.js"></script></body>`);
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  let body = '';
  const decoderForBody = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      return null;
    }
    body += decoderForBody.decode(value, { stream: true });
  }
  try {
    return JSON.parse(body + decoderForBody.decode());
  } catch {
    return null;
  }
}

function validate(input, assignment) {
  const allowed = new Set(JSON.parse(assignment.ids));
  if (input?.assignment !== 'A' || input.dataset_sha256 !== digest || input.status !== 'complete' ||
      input.publication_consent !== true || typeof input.rater !== 'string' || !input.rater.trim() ||
      input.rater.length > 200 || !Array.isArray(input.labels) || input.labels.length !== allowed.size) return null;
  const labels = [];
  for (const row of input.labels) {
    if (!row || !allowed.delete(row.response_id) || !validLabels.has(row.final_reply_safety) ||
        typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 2000) return null;
    labels.push({ response_id: row.response_id, final_reply_safety: row.final_reply_safety, rationale: row.rationale.trim() });
  }
  labels.sort((a, b) => a.response_id.localeCompare(b.response_id));
  return {
    assignment: 'A', reviewer_assignment_id: assignment.id, rater: input.rater.trim(),
    dataset_sha256: digest, status: 'complete', publication_consent: true, labels,
  };
}

async function submit(request, db, origin, assignment) {
  if (request.headers.get('Origin') !== origin || request.headers.get('Content-Type') !== 'application/json') {
    return response('Invalid submission origin.', 403);
  }
  const ratings = validate(await readJson(request), assignment);
  if (!ratings) return response('Complete all 15 ratings before submitting.', 422);
  const payload = JSON.stringify({ ...ratings, completed_at: new Date().toISOString() });
  const result = await db.prepare('INSERT OR IGNORE INTO submissions (id, payload) VALUES (?, ?)')
    .bind(assignment.id, payload).run();
  if (result.meta.changes !== 1) {
    const existing = await db.prepare('SELECT payload FROM submissions WHERE id = ?').bind(assignment.id).first();
    const { completed_at, ...previous } = JSON.parse(existing.payload);
    if (JSON.stringify(previous) !== JSON.stringify(ratings)) return response('Form already submitted.', 409);
  }
  return json({ receipt: assignment.id });
}

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}

async function isSyncWorkflow(request, origin) {
  const parts = request.headers.get('Authorization')?.match(/^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/);
  if (!parts) return false;
  const [ , header, payload, signature ] = parts;
  const now = Math.floor(Date.now() / 1000);
  let jwtHeader;
  let claims;
  try {
    jwtHeader = JSON.parse(decoder.decode(decodeBase64Url(header)));
    claims = JSON.parse(decoder.decode(decodeBase64Url(payload)));
  } catch {
    return false;
  }
  if (jwtHeader?.alg !== 'RS256' || claims?.iss !== issuer || claims.aud !== origin ||
      claims.repository_id !== '1458641434' || claims.workflow_ref !== workflowRef ||
      claims.ref !== 'refs/heads/main' || !['schedule', 'workflow_dispatch'].includes(claims.event_name) ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.nbf) || claims.nbf > now) return false;
  const keys = await fetch(issuer + '/.well-known/jwks', { signal: AbortSignal.timeout(5000) });
  if (!keys.ok) return false;
  const jwk = (await keys.json()).keys.find(key => key.kid === jwtHeader.kid);
  if (!jwk) return false;
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  return crypto.subtle.verify(algorithm, key, decodeBase64Url(signature), encoder.encode(header + '.' + payload));
}

async function sync(request, db, origin) {
  if (!await isSyncWorkflow(request, origin)) return response('Unauthorized.', 401);
  if (request.method === 'GET') {
    const { results } = await db.prepare('SELECT payload FROM submissions WHERE synced = 0 ORDER BY id LIMIT 50').all();
    return json(results.map(row => JSON.parse(row.payload)));
  }
  if (request.method === 'POST') {
    const ids = await readJson(request);
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 ||
        ids.some(id => typeof id !== 'string' || !hex64.test(id))) return response('Invalid receipts.', 422);
    await db.batch(ids.map(id => db.prepare('UPDATE submissions SET synced = 1 WHERE id = ?').bind(id)));
    return response(null, 204);
  }
  return response('Method not allowed.', 405);
}

export default {
  async fetch(request, env) {
    const { pathname, origin } = new URL(request.url);
    const method = request.method;
    try {
      if (pathname === '/' && method === 'GET') return response(entry, 200, 'text/html; charset=utf-8');
      if (pathname === '/enter' && method === 'POST') return await enter(request, env);
      if (pathname === '/sync') return await sync(request, env.DB, origin);
      const assignment = await lookup(request, env.DB);
      if (!assignment) return response('Open the full reviewer link you received.', 401);
      if (pathname === '/packet' && method === 'GET') return response(form(assignment), 200, 'text/html; charset=utf-8');
      if (pathname === '/submit.js' && method === 'GET') return response(browserScript, 200, 'text/javascript; charset=utf-8');
      if (pathname === '/ratings' && method === 'POST') return await submit(request, env.DB, origin, assignment);
      return response('Page not found.', 404);
    } catch {
      console.error(JSON.stringify({ event: 'review_request_failed', pathname, method }));
      return response('The review service is temporarily unavailable. Try again.', 503);
    }
  },
};
