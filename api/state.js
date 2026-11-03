// Lynntimes Ryder Cup: shared live state for the tracker (Vercel Serverless Function, no dependencies).
// Storage: Upstash Redis REST API. Connect "Upstash for Redis" from the Vercel Marketplace; it injects
// KV_REST_API_URL and KV_REST_API_TOKEN (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also work).
// Writes need the header x-score-pin to match the SCORE_PIN environment variable (when SCORE_PIN is set).
//
//   GET  /api/state?since=<rev>  -> { rev, matches, meta, pin }  or  { rev, unchanged: true, pin }
//   POST /api/state  { op: 'match', id: 'm01'..'m18', data: {...} | null }
//                    { op: 'meta', data: { ended, endedAt } }
//                    { op: 'wipe' }   { op: 'check' }   (check = verify the PIN only)

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PIN = (process.env.SCORE_PIN || '').trim();
const PREFIX = process.env.CUP_KEY_PREFIX || 'lynntimes:cup:v1';
const K = { matches: PREFIX + ':matches', meta: PREFIX + ':meta', rev: PREFIX + ':rev' };
const MATCH_IDS = new Set(Array.from({ length: 18 }, (_, i) => 'm' + String(i + 1).padStart(2, '0')));
const MAX_DOC = 8000; // bytes per stored document

async function redis(endpoint, commands) {
  const r = await fetch(REDIS_URL + endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('redis_http_' + r.status);
  const out = await r.json();
  const failed = Array.isArray(out) ? out.find((x) => x && x.error) : out && out.error ? out : null;
  if (failed) throw new Error('redis_error: ' + failed.error);
  return out;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) return send(res, 503, { error: 'not_configured' });
  try {
    if (req.method === 'GET') {
      const raw = (req.query && req.query.since) != null ? req.query.since : new URL(req.url, 'http://local').searchParams.get('since');
      const since = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      const [cur] = await redis('/pipeline', [['GET', K.rev]]);
      const rev = Number(cur.result || 0);
      if (Number.isFinite(since) && since >= 0 && since === rev) return send(res, 200, { rev, unchanged: true, pin: !!PIN });
      const [all, meta, rev2] = await redis('/pipeline', [['HGETALL', K.matches], ['GET', K.meta], ['GET', K.rev]]);
      const flat = Array.isArray(all.result) ? all.result : [];
      const matches = {};
      for (let i = 0; i + 1 < flat.length; i += 2) {
        try { matches[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip a corrupt entry */ }
      }
      let m = {};
      try { m = meta.result ? JSON.parse(meta.result) : {}; } catch (e) { m = {}; }
      return send(res, 200, { rev: Number(rev2.result || 0), matches, meta: m, pin: !!PIN });
    }
    if (req.method === 'POST') {
      if (PIN && String(req.headers['x-score-pin'] || '') !== PIN) return send(res, 401, { error: 'bad_pin' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_body' });
      if (body.op === 'check') return send(res, 200, { ok: true, pin: !!PIN });
      const cmds = [];
      if (body.op === 'match') {
        if (!MATCH_IDS.has(body.id)) return send(res, 400, { error: 'bad_id' });
        if (body.data === null) {
          cmds.push(['HDEL', K.matches, body.id]);
        } else {
          if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return send(res, 400, { error: 'bad_data' });
          const s = JSON.stringify(body.data);
          if (s.length > MAX_DOC) return send(res, 413, { error: 'too_large' });
          cmds.push(['HSET', K.matches, body.id, s]);
        }
      } else if (body.op === 'meta') {
        const s = JSON.stringify(body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {});
        if (s.length > MAX_DOC) return send(res, 413, { error: 'too_large' });
        cmds.push(['SET', K.meta, s]);
      } else if (body.op === 'wipe') {
        cmds.push(['DEL', K.matches], ['DEL', K.meta]);
      } else {
        return send(res, 400, { error: 'bad_op' });
      }
      cmds.push(['INCR', K.rev]);
      const out = await redis('/multi-exec', cmds);
      return send(res, 200, { ok: true, rev: Number(out[out.length - 1].result) });
    }
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: 'storage_unavailable' });
  }
};
