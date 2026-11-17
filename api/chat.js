// Nova AI server: forwards chat messages to free AI providers and streams the
// answer back. API keys stay here on the server and are never sent to the browser.
//
// Free pool: add a key for any of these in Vercel and Nova uses it. When one
// provider is busy or out of free messages, Nova moves on to the next one.
//   GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY
// PROVIDERS (optional) sets the order, e.g. "groq,gemini,openrouter,mistral".
//
// Fair-use limit: each visitor gets RATE_LIMIT_PER_HOUR messages an hour and
// RATE_LIMIT_PER_DAY a day (defaults 30 and 150). Counts are kept in a free
// Upstash Redis database connected through Vercel (see README).

export const config = { runtime: 'edge' };

// Groq models for each mode in the model picker (change them in Vercel if Groq retires one).
const GROQ_MODELS = {
  smart: () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  fast: () => process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
  vision: () => process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
};

// Free plans limit tokens per minute, so Nova trims old messages to stay under
// this many characters (about 4 characters per token). Smaller = more people served.
const MAX_CONTEXT_CHARS = () => +process.env.MAX_CONTEXT_CHARS || 16000;
const MAX_IMAGES = 4;

function systemPrompt(instructions) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  let p = `You are Nova, a helpful, friendly AI assistant. Today is ${today}.
- Answer clearly and get to the point. Use Markdown (headings, lists, tables, **bold**, code blocks with a language tag) when it makes things easier to read.
- When web search is available and the question is about current events, prices, people, or anything that may have changed, look it up instead of guessing.
- Choose reliable sources: official sites (government, company, school or organization pages), established news outlets, encyclopedias, and peer-reviewed or expert sources. Avoid forums, random blogs, content farms and AI-generated SEO pages unless nothing better exists, and say so if you had to use them.
- When sources disagree, say that, and go with the most authoritative and most recent one.
- When you used the web, end with a short "Sources:" list of the pages you relied on. Never invent a source, link or quote.
- If you couldn't verify something, say it's unverified instead of stating it as fact.
- When the user attaches files or links, base your answer on their contents.
- When the user attaches an image, look at it carefully and describe or use what you see.
- If you don't know something, say so.`;
  if (instructions) p += `\n\nThe user set these custom instructions. Follow them unless they conflict with being honest and safe:\n${instructions}`;
  return p;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const KEY_ENV = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY', mistral: 'MISTRAL_API_KEY' };

function friendlyError(name, status, raw, envModel) {
  const envKey = KEY_ENV[name];
  if (status === 429) return "You've hit the free usage limit for now. Wait a minute (or until tomorrow if it keeps happening) and try again. Long messages and big files use the limit up faster.";
  if (status === 413) return 'That message is too big for the free plan. Try a shorter message or a smaller file.';
  if (status === 401 || status === 403 || (status === 400 && /API key/i.test(raw))) return `The API key was rejected. Check ${envKey} in your Vercel settings.`;
  if (status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(raw)) return `That AI model isn't available anymore. Set ${envModel} in Vercel to a current model (see README).`;
  try {
    const msg = JSON.parse(raw)?.error?.message;
    if (msg) return msg;
  } catch {}
  return `Something went wrong (error ${status}).`;
}

function parseDataUrl(url) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  return m ? { mime: m[1], data: m[2] } : null;
}

// ---------- Gemini ----------
async function callGemini({ history, web, sys }) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const payload = {
    contents: history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [
        ...(m.images || []).map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } })),
        { text: m.text },
      ],
    })),
    systemInstruction: { parts: [{ text: sys }] },
  };
  const call = (p) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(p),
    });

  let res;
  let webFallback = false;
  if (web) {
    res = await call({ ...payload, tools: [{ google_search: {} }, { url_context: {} }] });
    if (!res.ok && res.status !== 429) {
      res = await call(payload);
      webFallback = res.ok;
    }
  } else {
    res = await call(payload);
  }
  return { res, webFallback, envModel: 'GEMINI_MODEL' };
}

// ---------- Groq (OpenAI-style API) ----------
async function callGroq({ history, web, sys, mode }) {
  const key = process.env.GROQ_API_KEY;
  const hasImages = history.some((m) => m.images && m.images.length);
  const pick = hasImages ? 'vision' : mode === 'fast' ? 'fast' : 'smart';
  const model = GROQ_MODELS[pick]();
  const envModel = { smart: 'GROQ_MODEL', fast: 'GROQ_FAST_MODEL', vision: 'GROQ_VISION_MODEL' }[pick];

  const base = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: sys },
      ...history.map((m) => {
        if (m.role !== 'user') return { role: 'assistant', content: m.text };
        if (!m.images || !m.images.length) return { role: 'user', content: m.text };
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.text },
            ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })),
          ],
        };
      }),
    ],
  };
  const call = (p) =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(p),
    });

  // GPT-OSS models on Groq have a built-in web search tool. If Groq refuses it
  // (for example on the free plan), answer without it instead of failing.
  if (web && /gpt-oss/.test(model)) {
    const res = await call({ ...base, tools: [{ type: 'browser_search' }] });
    if (res.ok || res.status === 429) return { res, webFallback: false, envModel };
    const res2 = await call(base);
    return { res: res2, webFallback: res2.ok, envModel };
  }
  const res = await call(base);
  return { res, webFallback: !!web, envModel };
}

// ---------- Other OpenAI-style providers (OpenRouter, Mistral) ----------
// These are text-only here; when a message has images Nova skips them.
const OPENAI_STYLE = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    // "openrouter/free" automatically picks one of OpenRouter's current free models.
    model: () => process.env.OPENROUTER_MODEL || 'openrouter/free',
    envModel: 'OPENROUTER_MODEL',
    extraHeaders: { 'HTTP-Referer': 'https://vercel.app', 'X-Title': 'Nova AI' },
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: () => process.env.MISTRAL_MODEL || 'mistral-small-latest',
    envModel: 'MISTRAL_MODEL',
    extraHeaders: {},
  },
};

function openAIStyleCaller(name) {
  const cfg = OPENAI_STYLE[name];
  return async ({ history, web, sys }) => {
    if (history.some((m) => m.images && m.images.length)) {
      // Pretend "unavailable" so the loop moves on to a provider that can see images.
      return { res: new Response('{"error":{"message":"no image support"}}', { status: 415 }), webFallback: false, envModel: cfg.envModel, skipped: true };
    }
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[KEY_ENV[name]]}`, ...cfg.extraHeaders },
      body: JSON.stringify({
        model: cfg.model(),
        stream: true,
        messages: [
          { role: 'system', content: sys },
          ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        ],
      }),
    });
    return { res, webFallback: !!web, envModel: cfg.envModel };
  };
}

const PROVIDERS = {
  groq: callGroq,
  gemini: callGemini,
  openrouter: openAIStyleCaller('openrouter'),
  mistral: openAIStyleCaller('mistral'),
};

function providerOrder() {
  const wanted = (process.env.PROVIDERS || process.env.PROVIDER || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  const all = ['groq', 'gemini', 'openrouter', 'mistral'];
  const order = [...wanted.filter((x) => all.includes(x)), ...all.filter((x) => !wanted.includes(x))];
  return order.filter((name) => process.env[KEY_ENV[name]]);
}

// ---------- Fair-use limit ----------
const LIMITS = () => ({
  hour: +process.env.RATE_LIMIT_PER_HOUR || 30,
  day: +process.env.RATE_LIMIT_PER_DAY || 150,
  // Backstop per network (a whole school can share one address, so it's high).
  ipHour: +process.env.RATE_LIMIT_IP_PER_HOUR || 400,
});

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

// Without a database, counts live in this server instance's memory: it still
// slows down spam, but resets whenever Vercel starts a fresh instance.
const memoryCounts = new Map();
async function bump(keys) {
  const redis = redisConfig();
  if (redis) {
    const cmds = keys.flatMap(([k, ttl]) => [['INCR', k], ['EXPIRE', k, String(ttl), 'NX']]);
    const res = await fetch(`${redis.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!res.ok) throw new Error('redis ' + res.status);
    const out = await res.json();
    return keys.map((_, i) => Number(out[i * 2]?.result || 0));
  }
  const now = Date.now();
  if (memoryCounts.size > 5000) for (const [k, v] of memoryCounts) if (v.exp < now) memoryCounts.delete(k);
  return keys.map(([k, ttl]) => {
    const e = memoryCounts.get(k);
    if (!e || e.exp < now) { memoryCounts.set(k, { n: 1, exp: now + ttl * 1000 }); return 1; }
    return ++e.n;
  });
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkLimit(req, visitor) {
  const L = LIMITS();
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600), day = Math.floor(now / 86400);
  // Visitors are told apart by a random id their browser keeps, plus their network.
  const who = await sha((/^[a-z0-9-]{8,64}$/i.test(visitor || '') ? visitor : 'anon') + '|' + ip);
  const net = await sha('ip|' + ip);
  let counts;
  try {
    counts = await bump([[`nova:v:${who}:h:${hour}`, 3700], [`nova:v:${who}:d:${day}`, 90000], [`nova:ip:${net}:h:${hour}`, 3700]]);
  } catch {
    return { ok: true, remaining: null }; // if the counter is down, don't block people
  }
  const [h, d, ipH] = counts;
  const untilHour = 3600 - (now % 3600), untilDay = 86400 - (now % 86400);
  if (d > L.day) return { ok: false, retry: untilDay, error: `You've used all ${L.day} of today's free messages. Come back tomorrow!` };
  if (h > L.hour) return { ok: false, retry: untilHour, error: `You've reached the limit of ${L.hour} messages per hour. Try again in ${Math.ceil(untilHour / 60)} minutes.` };
  if (ipH > L.ipHour) return { ok: false, retry: untilHour, error: `Lots of people on your network are using Nova right now. Try again in ${Math.ceil(untilHour / 60)} minutes.` };
  return { ok: true, remaining: Math.min(L.hour - h, L.day - d) };
}

// ---------- Link reader ----------
// If the newest message has links in it, Nova opens them here, pulls out the
// readable text, and hands that text to the AI along with the question.
const MAX_LINKS = 3;
const MAX_CHARS_PER_PAGE = 6000; // kept small to fit Groq's free per-minute token limit

function isPrivateHost(host) {
  host = host.toLowerCase();
  return (
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith('[')
  );
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } });
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  body = body
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
  return { title: decodeEntities(title).trim(), text: body };
}

async function readLink(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(u.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NovaAI/1.0; personal assistant)',
        Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
      },
    });
    if (!res.ok) return { url: u.href, error: `the site returned error ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!/text\/|json|xml/.test(type)) return { url: u.href, error: "it isn't a web page (it may be a file, image or video)" };
    const raw = (await res.text()).slice(0, 2_000_000);
    const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: '', text: raw };
    if (text.length < 200) return { url: u.href, title, error: 'the page had almost no readable text (it may need JavaScript or a login)' };
    return { url: u.href, title, text: text.slice(0, MAX_CHARS_PER_PAGE) };
  } catch {
    return { url: u.href, error: 'the page took too long or could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

async function addLinkContents(history) {
  const last = history[history.length - 1];
  const urls = [...new Set((last.text.match(/https?:\/\/[^\s<>()"']+/g) || []).map((x) => x.replace(/[.,;:!?]+$/, '')))].slice(0, MAX_LINKS);
  if (!urls.length) return [];
  const pages = (await Promise.all(urls.map(readLink))).filter(Boolean);
  if (!pages.length) return [];
  let extra = '\n\n---\nNova opened the link(s) in this message. Use this page content to answer, and say if something you need is not in it.\n';
  for (const p of pages) {
    extra += p.text
      ? `\n[Page: ${p.title || p.url}]\nURL: ${p.url}\n${p.text}\n`
      : `\n[Could not read ${p.url}: ${p.error}. Tell the user, and suggest pasting the text instead.]\n`;
  }
  last.text += extra;
  return pages.filter((p) => p.text).map((p) => ({ uri: p.url, title: p.title || p.url }));
}


// Keep the newest messages that fit in the character budget.
function fitToBudget(history, budget) {
  const last = history[history.length - 1];
  if (last.text.length > budget) last.text = last.text.slice(0, budget) + '\n\n[...the rest was cut off because it was too long for the free plan]';
  let used = last.text.length;
  const kept = [last];
  for (let i = history.length - 2; i >= 0; i--) {
    used += history[i].text.length;
    if (used > budget) break;
    kept.unshift(history[i]);
  }
  // Conversations must start with a user message.
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  return kept;
}

export default async function handler(req) {
  // The page asks this once to know which features to show.
  if (req.method === 'GET') {
    return json({
      web: !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY),
      providers: providerOrder(),
      locked: !!process.env.SITE_PASSWORD,
      limitPerHour: LIMITS().hour,
    });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request (the message may be too big).' }, 400);
  }

  // Optional password (leave SITE_PASSWORD unset for a public site anyone can use).
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword && body.password !== sitePassword) {
    return json({ error: 'Wrong password', needPassword: true }, 401);
  }

  const available = providerOrder();
  if (!available.length) return json({ error: 'No API key is set in Vercel yet. Add GROQ_API_KEY (see README).' }, 500);

  const raw = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  let history = raw
    .filter((m) => m && typeof m.text === 'string' && (m.text.trim() || (m.images && m.images.length)))
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      text: m.text.slice(0, 100000) || 'What is in this image?',
      images: m.role === 'user' && Array.isArray(m.images) ? m.images.map(parseDataUrl).filter(Boolean).slice(0, MAX_IMAGES) : [],
    }));

  if (!history.length || history[history.length - 1].role !== 'user') {
    return json({ error: 'No message to answer.' }, 400);
  }

  // Fair-use limit, checked only for real messages.
  const limit = await checkLimit(req, body.visitor);
  if (!limit.ok) {
    return new Response(JSON.stringify({ error: limit.error, limited: true }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(limit.retry) },
    });
  }

  // Only the newest message keeps its images; older ones become a short note.
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].images.length) {
      history[i].text += `\n[${history[i].images.length} image(s) were attached here earlier]`;
      history[i].images = [];
    }
  }

  const readLinks = await addLinkContents(history);
  history = fitToBudget(history, MAX_CONTEXT_CHARS());

  const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 1500).trim() : '';
  const sys = systemPrompt(instructions);
  const mode = body.model === 'fast' ? 'fast' : 'smart';

  let lastError = null;
  let busy = 0, tried = 0;
  for (const name of available) {
    let result;
    try {
      result = await PROVIDERS[name]({ history, web: !!body.web, sys, mode });
    } catch {
      lastError = { status: 502, error: `Could not reach ${name}.` };
      continue;
    }
    const { res, webFallback, envModel, skipped } = result;
    if (skipped) continue;
    tried++;
    if (res.ok) {
      return new Response(res.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Provider': name,
          'X-Web-Fallback': webFallback ? '1' : '0',
          'X-Read-Links': encodeURIComponent(JSON.stringify(readLinks)),
          ...(limit.remaining != null ? { 'X-Limit-Remaining': String(limit.remaining) } : {}),
        },
      });
    }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) busy++;
    lastError = { status: res.status, error: friendlyError(name, res.status, text, envModel) };
  }

  if (!tried) return json({ error: 'None of the AI providers on this site can look at images right now. Try asking without the picture.' }, 503);
  if (busy === tried) return json({ error: "Nova is really busy right now and the free AI is maxed out. Try again in a minute or two." }, 503);
  return json({ error: lastError.error }, lastError.status);
}
