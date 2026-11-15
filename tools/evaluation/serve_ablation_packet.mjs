import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const folder = process.env.RATINGS_FOLDER ?? 'recordings/final-evaluation';
const submissionFolder = join(folder, 'ratings-online');
const assignmentFolder = join(folder, 'rating-assignments');
const accessKey = process.env.RATINGS_ACCESS_KEY ?? '';
const origin = new URL(process.env.RATINGS_ORIGIN ?? 'http://localhost:8091');
const port = Number(process.env.PORT ?? 8091);
const githubToken = process.env.RATINGS_GITHUB_TOKEN;
const githubBranch = process.env.RATINGS_GITHUB_BRANCH ?? 'main';
const githubRepository = 'Suyogadk1/Review-form';
const githubContents = `https://api.github.com/repos/${githubRepository}/contents/evaluation-submissions/packet-a`;

if (!/^[a-f0-9]{64}$/.test(accessKey)) {
  throw new Error('Set RATINGS_ACCESS_KEY to 32 random bytes encoded as hex.');
}
if (origin.protocol === 'https:' && !githubToken) {
  throw new Error('Set RATINGS_GITHUB_TOKEN before hosting a live form.');
}

const packet = await readFile(join(folder, 'Ablation_Rater_A.html'), 'utf8');
const source = packet.match(/<script>const data=(.*?);const assignment='A';const dataset_sha256='([a-f0-9]{64})';function el/s);
if (!source) throw new Error('Expected a generated assignment A packet.');
const [ , rawRows, datasetDigest ] = source;
const rows = new Map(JSON.parse(rawRows).map(row => [row.response_id, row]));
const selection = JSON.parse(await readFile(join(folder, 'ablation-online-selection.json'), 'utf8'));
const { shared_high, shared_medium, high, medium } = selection;
const eligible = [shared_high, shared_medium, high, medium].flat();
if (selection.dataset_sha256 !== datasetDigest || shared_high.length !== 2 || shared_medium.length !== 2 ||
    high.length < 7 || medium.length < 6 || new Set(eligible).size !== eligible.length ||
    eligible.some(id => !rows.has(id))) {
  throw new Error('Invalid selection for this dataset. Supply two shared questions at each risk level and distinct pools.');
}
const browserScript = await readFile(new URL('./ablation_online_submit.js', import.meta.url), 'utf8');
const submissionRepository = JSON.stringify(githubToken ? githubRepository : null);

const entry = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MindCare ratings</title><h1>MindCare ratings</h1>
<p id="status" role="status">Opening your rating packet…</p>
<script>
const key = location.hash.slice(1);
if (key) history.replaceState(null, '', '/');
async function enter() {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Open the full rating link you received.');
  const response = await fetch('/enter', {method: 'POST', headers: {Authorization: 'Bearer ' + key}});
  if (!response.ok) throw new Error('This rating link is invalid or has expired.');
  location.replace('/packet');
}
enter().catch(error => { document.querySelector('#status').textContent = error.message; });
</script></html>`;

function reply(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(body);
}

function matchesKey(candidate) {
  return typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate) &&
    timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(accessKey, 'hex'));
}

function sample(items, count) {
  const available = [...items];
  return Array.from({ length: count }, () => available.splice(randomInt(available.length), 1)[0]);
}

function sign(id) {
  return createHmac('sha256', signingKey).update(`${accessKey}:${datasetDigest}:${id}`).digest('hex');
}

function assignmentPath(id) {
  return join(assignmentFolder, `${datasetDigest}-${id}.json`);
}

async function publishFile(target, content) {
  const temp = join(assignmentFolder, `.${randomUUID()}.tmp`);
  await writeFile(temp, content, { flag: 'wx', mode: 0o600, flush: true });
  try {
    await link(temp, target);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    await unlink(temp);
  }
}

async function newAssignment() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ids = sample([...shared_high, ...shared_medium, ...sample(high, 6), ...sample(medium, 5)], 15);
    const id = createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
    if (await publishFile(assignmentPath(id), JSON.stringify(ids))) return { id, ids };
  }
  throw new Error('Unable to allocate an unused rating assignment.');
}

async function readAssignment(request) {
  const match = request.headers.cookie?.match(/(?:^|;\s*)mindcare_assignment=([a-f0-9]{64})\.([a-f0-9]{64})(?:;|$)/);
  if (!match) return null;
  const [ , id, signature ] = match;
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(id), 'hex'))) return null;
  try {
    return { id, ids: JSON.parse(await readFile(assignmentPath(id), 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function renderPacket(ids) {
  const data = JSON.stringify(ids.map(id => rows.get(id))).replace(/</g, '\\u003c');
  return packet.replace(source[0], () => source[0].replace(rawRows, () => data))
    .replace('</html>', `<script>const submissionRepository = ${submissionRepository};</script><script src="/submit.js"></script></html>`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) return null;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validate(input, { id, ids }) {
  if (!input || input.assignment !== 'A' || input.dataset_sha256 !== datasetDigest ||
      input.status !== 'complete' || typeof input.rater !== 'string' || !input.rater.trim() ||
      input.rater.length > 200 || (githubToken && input.publication_consent !== true) ||
      !Array.isArray(input.labels) || input.labels.length !== ids.length) return null;
  const allowed = new Set(ids);
  const seen = new Set();
  const labels = [];
  for (const row of input.labels) {
    if (!row || !allowed.has(row.response_id) || seen.has(row.response_id) ||
        !['safe', 'unsafe', 'uncertain'].includes(row.final_reply_safety) ||
        typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 2000) {
      return null;
    }
    seen.add(row.response_id);
    labels.push({
      response_id: row.response_id,
      final_reply_safety: row.final_reply_safety,
      rationale: row.rationale.trim(),
    });
  }
  labels.sort((first, second) => first.response_id.localeCompare(second.response_id));
  return {
    assignment: 'A',
    reviewer_assignment_id: id,
    rater: input.rater.trim(),
    publication_consent: input.publication_consent === true,
    dataset_sha256: datasetDigest,
    status: 'complete',
    labels,
  };
}

let githubWrites = Promise.resolve();

async function commitToGitHub(name, content) {
  const url = `${githubContents}/${datasetDigest}/${name}`;
  const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' };
  const result = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branch: githubBranch,
      message: 'Record completed packet A ratings',
      content: Buffer.from(content).toString('base64'),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (result.status === 201) return;
  if (result.status === 409 || result.status === 422) {
    const existing = await fetch(`${url}?ref=${encodeURIComponent(githubBranch)}`,
      { headers, signal: AbortSignal.timeout(10000) });
    if (existing.ok) {
      const found = await existing.json();
      if (found.encoding === 'base64' && Buffer.from(found.content, 'base64').toString('utf8') === content) return;
    }
  }
  throw new Error(`GitHub rejected the ratings file (${result.status}).`);
}

async function saveRatings(ratings) {
  const name = `A-${datasetDigest}-${ratings.reviewer_assignment_id}.json`;
  const target = join(submissionFolder, name);
  const content = JSON.stringify({ ...ratings, completed_at: new Date().toISOString() }, null, 2) + '\n';
  const created = await publishFile(target, content);
  const saved = created ? content : await readFile(target, 'utf8');
  const { completed_at, ...previous } = JSON.parse(saved);
  if (JSON.stringify(previous) !== JSON.stringify(ratings)) return null;
  if (githubToken) {
    const writing = githubWrites.then(() => commitToGitHub(name, saved));
    githubWrites = writing.catch(() => {});
    await writing;
  }
  return name;
}

await Promise.all([submissionFolder, assignmentFolder].map(path => mkdir(path, { recursive: true, mode: 0o700 })));
const signingKeyPath = join(assignmentFolder, '.signing-key');
try {
  await readFile(signingKeyPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await publishFile(signingKeyPath, randomBytes(32));
}
const signingKey = await readFile(signingKeyPath);

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, origin).pathname;
    if (request.method === 'GET' && path === '/') {
      return reply(response, 200, entry, 'text/html; charset=utf-8');
    }
    if (request.method === 'POST' && path === '/enter') {
      const key = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!matchesKey(key)) {
        return reply(response, 401, 'Invalid rating link.');
      }
      const { id } = await readAssignment(request) ?? await newAssignment();
      const secure = origin.protocol === 'https:' ? '; Secure' : '';
      response.setHeader('Set-Cookie', `mindcare_assignment=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`);
      return reply(response, 204, '');
    }
    const assignment = await readAssignment(request);
    if (!assignment) return reply(response, 401, 'Open the full rating link you received.');
    if (request.method === 'GET' && path === '/packet') {
      return reply(response, 200, renderPacket(assignment.ids), 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && path === '/submit.js') {
      return reply(response, 200, browserScript, 'text/javascript; charset=utf-8');
    }
    if (request.method === 'POST' && path === '/ratings') {
      if (request.headers.origin !== origin.origin || request.headers['content-type'] !== 'application/json') {
        return reply(response, 403, 'Invalid submission origin.');
      }
      let ratings;
      try {
        ratings = validate(await readJson(request), assignment);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (!ratings) return reply(response, 422, 'Complete every rating and use the current packet.');
      const receipt = await saveRatings(ratings);
      if (!receipt) return reply(response, 409, 'This assignment already has a different completed submission.');
      return reply(response, 200, JSON.stringify({ receipt }), 'application/json; charset=utf-8');
    }
    return reply(response, 404, 'Page not found.');
  } catch (error) {
    console.error('Ratings request failed', error.code ?? error.name);
    if (!response.headersSent) reply(response, 500, 'Could not save ratings. Please try again.');
  }
}).listen(port, process.env.RATINGS_HOST ?? '127.0.0.1', () => {
  console.log(`Ratings service listening on port ${port} for ${origin.origin}`);
});
