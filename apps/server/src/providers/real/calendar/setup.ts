/**
 * The one-time calendar setup page and the routes behind it, outside the display contract:
 *
 *   GET  /api/calendar/setup             the page (it pairs itself with the server's code)
 *   GET  /api/calendar/setup/state       status, calendars and choices          (device key)
 *   POST /api/calendar/setup/prefs       save choices                           (device key)
 *   POST /api/calendar/sync              sync now                               (device key)
 *   POST /api/calendar/google/start      the Google consent URL                 (device key)
 *   GET  /api/calendar/google/callback   Google's redirect back                 (state check)
 *   POST /api/calendar/google/finish     paste-back of the redirect address     (device key)
 *   POST /api/calendar/google/disconnect forget the Google tokens               (device key)
 *   POST /api/calendar/google/push       Google push notifications              (channel token)
 */
import { DEVICE_KEY_HEADER } from '@mantel/shared';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { DeviceAuth } from '../../../auth.js';
import { HttpError } from '../../../errors.js';
import { log } from '../../../log.js';
import type { ProviderContext } from '../../types.js';
import type { RealCalendar } from './index.js';
import { pushAddress } from './urls.js';
import { isEnabled, isMeals, toCalendar } from './normalize.js';
import type { CalendarPrefs } from './types.js';

const Prefs = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      enabled: z.boolean().optional(),
      name: z.string().max(80).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      personIds: z.array(z.string()).optional(),
      isMeals: z.boolean().optional(),
    }),
  ),
  defaultCalendarId: z.string().optional(),
});

const Finish = z.object({ url: z.string().min(1) });

export function setupState(cal: RealCalendar, ctx: ProviderContext) {
  const prefs = cal.prefs();
  const people = ctx.settings().people;
  const tokens = cal.googleAuth.tokens();
  return {
    google: {
      ...cal.sourceStatus('google'),
      account: tokens?.account ?? null,
      revoked: Boolean(tokens?.revoked),
      redirectUri: cal.redirect.uri,
      pasteBack: cal.redirect.pasteBack,
      push: Boolean(pushAddress(ctx.config)),
      pushActive: cal.pushActive(),
    },
    icloud: { ...cal.sourceStatus('icloud'), username: cal.env.ICLOUD_USERNAME ?? null },
    people: people.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    defaultCalendarId: cal.defaultCalendar(prefs)?.id ?? null,
    calendars: cal.sourceCalendars().map((c) => {
      const out = toCalendar(c, prefs, people);
      return {
        ...out,
        sourceName: c.name,
        sourceColor: c.color,
        enabled: isEnabled(c, prefs),
        isMeals: isMeals(c, prefs),
        primary: Boolean(c.primary),
      };
    }),
  };
}

export function mountCalendarSetup(
  api: Hono,
  auth: DeviceAuth,
  cal: RealCalendar,
  ctx: ProviderContext,
) {
  const guard = (c: Context) => {
    if (!auth.verify(c.req.header(DEVICE_KEY_HEADER)))
      throw new HttpError('unauthorized', 'pair this page with the code from the server log');
  };
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError('bad_request', parsed.error.message);
    return parsed.data;
  };
  const connected = async () => {
    cal.start();
    await cal.sync();
  };

  api.get('/calendar/setup', (c) => c.html(SETUP_PAGE));

  api.get('/calendar/setup/state', (c) => {
    guard(c);
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/setup/prefs', async (c) => {
    guard(c);
    const next: CalendarPrefs = await body(c, Prefs);
    cal.setPrefs(next);
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/sync', async (c) => {
    guard(c);
    if (!cal.store.sourceCalendars().length) cal.start();
    await cal.sync();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/start', (c) => {
    guard(c);
    return c.json({ url: cal.googleAuth.authUrl(), redirectUri: cal.redirect.uri });
  });

  api.get('/calendar/google/callback', async (c) => {
    const { code, state, error } = c.req.query();
    if (error || !code || !state)
      return c.html(
        resultPage(false, error ? `Google said: ${error}` : 'No code in the address.'),
        400,
      );
    try {
      await cal.googleAuth.finish(code, state);
      await connected();
      return c.redirect('/api/calendar/setup?google=connected');
    } catch (err) {
      return c.html(resultPage(false, err instanceof Error ? err.message : String(err)), 400);
    }
  });

  api.post('/calendar/google/finish', async (c) => {
    guard(c);
    const { url } = await body(c, Finish);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new HttpError('bad_request', 'paste the whole address from the browser bar');
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code || !state) throw new HttpError('bad_request', 'that address has no code in it');
    await cal.googleAuth.finish(code, state);
    await connected();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/disconnect', (c) => {
    guard(c);
    cal.googleAuth.disconnect();
    return c.json(setupState(cal, ctx));
  });

  api.post('/calendar/google/push', (c) => {
    const ok = cal.onPush(
      c.req.header('x-goog-channel-id'),
      c.req.header('x-goog-channel-token'),
      c.req.header('x-goog-resource-state'),
    );
    if (!ok) log.debug('google push for an unknown channel');
    // Always 200: Google retries anything else, and an unknown channel just expires.
    return c.body(null, 200);
  });
}

function resultPage(ok: boolean, message: string) {
  const esc = message.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mantel calendars</title><style>body{font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#EFEEE9;color:#1B1F27;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#FBFAF7;border-radius:20px;padding:32px;max-width:520px;box-shadow:0 8px 24px rgba(27,31,39,.06)}a{color:#246B5B;font-weight:700}</style>
<main><h1>${ok ? 'Connected' : 'That did not work'}</h1><p>${esc}</p><p><a href="/api/calendar/setup">Back to calendar setup</a></p></main>`;
}

/* The page is plain HTML and a little script, styled with the mockup's Daylight tokens. */
const SETUP_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mantel · Calendars</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--display:"Fraunces",Georgia,serif;--body:"Manrope",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
--bg:#EFEEE9;--surface:#FBFAF7;--surface-2:#E7E5DE;--ink:#1B1F27;--ink-2:#626878;--ink-3:#9298A6;--line:rgba(27,31,39,.09);
--accent:#246B5B;--accent-soft:rgba(36,107,91,.12);--accent-ink:#fff;--warn:#C8761E;--good:#2E8B5B;
--shadow:0 1px 2px rgba(27,31,39,.06),0 8px 24px rgba(27,31,39,.06);--ease:cubic-bezier(.2,.8,.2,1)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body);-webkit-font-smoothing:antialiased}
main{max-width:880px;margin:0 auto;padding:40px 24px 80px;display:flex;flex-direction:column;gap:20px}
h1{font:400 44px/1.05 var(--display);letter-spacing:-.02em;margin:0}h2{font:500 24px/1.1 var(--display);margin:0}
.sub{color:var(--ink-2);margin:6px 0 0}.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);padding:24px;display:flex;flex-direction:column;gap:14px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grow{flex:1}
button,.btn{font:inherit;font-weight:700;height:48px;padding:0 20px;border-radius:999px;border:0;background:var(--accent);color:var(--accent-ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;transition:transform 150ms var(--ease)}
button:active{transform:scale(.97)}button.quiet{background:var(--surface-2);color:var(--ink)}button:disabled{opacity:.5}
input[type=text],input[type=password],input:not([type]){font:inherit;height:48px;border-radius:12px;border:1px solid var(--line);background:var(--bg);padding:0 14px;color:var(--ink);min-width:0}
code,.copy{font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;background:var(--surface-2);padding:3px 7px;border-radius:7px;word-break:break-all}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--surface-2);color:var(--ink-2)}
.pill.ok{background:rgba(46,139,91,.14);color:var(--good)}.pill.warn{background:rgba(200,118,30,.14);color:var(--warn)}
ol{margin:0;padding-left:22px;color:var(--ink-2)}ol li{margin:4px 0}ol b{color:var(--ink)}
.err{color:var(--warn);font-weight:600;min-height:1.5em}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:6px 8px}
td{padding:10px 8px;border-top:1px solid var(--line);vertical-align:middle}td input[type=text]{height:40px;width:100%}
.sw{width:22px;height:22px;accent-color:var(--accent)}.color{width:40px;height:40px;border:0;border-radius:10px;padding:0;background:none}
.who{display:flex;gap:6px;flex-wrap:wrap}.who label{display:inline-flex;align-items:center;gap:4px;padding:4px 10px 4px 6px;border-radius:999px;background:var(--surface-2);font-weight:600;font-size:13px;cursor:pointer}
.who label.on{background:color-mix(in srgb,var(--pc) 20%,transparent);box-shadow:inset 0 0 0 2px var(--pc)}.who i{width:10px;height:10px;border-radius:50%;background:var(--pc)}
.who input{display:none}.src{font-size:12px;color:var(--ink-3)}[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <header><h1>Calendars</h1><p class="sub">Connect the family's Google and iCloud calendars to the wall, then choose who each one belongs to.</p></header>

  <section class="card" id="pair" hidden>
    <h2>Pair this page</h2>
    <p class="sub">Enter the 6-digit code from the server log (it changes every 15 minutes). This page then gets its own device key, which you can revoke later.</p>
    <div class="row"><input id="code" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="Pairing code"><button id="pairBtn">Pair</button></div>
    <div class="err" id="pairErr"></div>
  </section>

  <div id="app" hidden style="display:flex;flex-direction:column;gap:20px">
    <section class="card">
      <div class="row"><h2 class="grow">Google</h2><span class="pill" id="gStatus"></span></div>
      <div id="gSetup">
        <ol>
          <li>Open <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Google Cloud console</a>, create a project, and enable the <b>Google Calendar API</b>.</li>
          <li>In <b>Google Auth Platform</b>, set the audience to <b>External</b> and press <b>Publish app</b> so the sign-in does not expire after 7 days. You will see an "unverified app" warning when you sign in; that is expected for a household app.</li>
          <li>Under <b>Clients</b>, create a <b>Web application</b> client with this authorised redirect URI: <span class="copy" id="gRedirect"></span></li>
          <li>Put the client ID and secret in the server's <code>.env</code> as <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, restart the container, and reload this page.</li>
        </ol>
      </div>
      <div id="gConnect" class="row">
        <button id="gBtn">Connect Google</button>
        <button class="quiet" id="gOff" hidden>Disconnect</button>
        <span class="sub" id="gAccount"></span>
      </div>
      <div id="gPaste" hidden>
        <p class="sub">After you allow access, Google sends your browser to <code>localhost</code>, which will not load from this computer. That is fine: copy the whole address from the browser bar and paste it here.</p>
        <div class="row"><input id="gUrl" class="grow" placeholder="http://localhost:8787/api/calendar/google/callback?code=..." aria-label="Address from the browser bar"><button id="gFinish">Finish</button></div>
      </div>
      <p class="sub" id="gPush"></p>
      <div class="err" id="gErr"></div>
    </section>

    <section class="card">
      <div class="row"><h2 class="grow">iCloud</h2><span class="pill" id="iStatus"></span></div>
      <p class="sub" id="iHelp">Create an app-specific password at <a href="https://account.apple.com" target="_blank" rel="noopener">account.apple.com</a> (Sign-In and Security, App-Specific Passwords), then set <code>ICLOUD_USERNAME</code> (your Apple ID email) and <code>ICLOUD_APP_PASSWORD</code> in <code>.env</code> and restart. Shared iCloud calendars appear here once accepted on an Apple device.</p>
      <div class="err" id="iErr"></div>
    </section>

    <section class="card">
      <div class="row"><h2 class="grow">On the wall</h2><button class="quiet" id="syncBtn">Sync now</button><button id="saveBtn">Save</button></div>
      <p class="sub">Tick the calendars to show. People: whose events they are (an event naming someone, like "Leo soccer", narrows to that person). The meal plan reads from the calendar marked Meals; "Dinner: Tacos" or an evening time puts it in the dinner slot. Quick add on the wall writes to the default calendar. Tag an event with ⭐ or #countdown to count down to it.</p>
      <table>
        <thead><tr><th>Show</th><th>Name</th><th>Colour</th><th>People</th><th>Meals</th><th>Default</th></tr></thead>
        <tbody id="cals"></tbody>
      </table>
      <p class="sub" id="empty" hidden>No calendars yet. Connect Google or iCloud above.</p>
      <div class="err" id="saveErr"></div>
    </section>
  </div>
</main>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'mantel.setupKey';
  let state = null;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  async function call(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json', '${DEVICE_KEY_HEADER}': localStorage.getItem(KEY) || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem(KEY); showPair(); throw new Error('Pair this page first.'); }
    if (!res.ok) throw new Error((json.error && json.error.message) || res.statusText);
    return json;
  }
  const showPair = () => { $('#pair').hidden = false; $('#app').hidden = true; };

  $('#pairBtn').onclick = async () => {
    $('#pairErr').textContent = '';
    try {
      const r = await call('POST', '/pair', { code: $('#code').value.trim(), name: 'Calendar setup page' });
      localStorage.setItem(KEY, r.deviceKey);
      load();
    } catch (e) { $('#pairErr').textContent = e.message; }
  };

  function pill(node, ok, text) { node.textContent = text; node.className = 'pill ' + (ok === true ? 'ok' : ok === false ? 'warn' : ''); }
  const when = (iso) => iso ? new Date(iso).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : 'never';

  function render() {
    const g = state.google, i = state.icloud;
    $('#pair').hidden = true; $('#app').hidden = false;
    $('#gRedirect').textContent = g.redirectUri;
    $('#gSetup').hidden = g.configured && g.connected;
    $('#gConnect').hidden = !g.configured;
    pill($('#gStatus'), g.connected ? true : g.configured ? false : undefined,
      g.revoked ? 'Sign in again' : g.connected ? 'Connected' : g.configured ? 'Not signed in' : 'Not set up');
    $('#gBtn').textContent = g.connected ? 'Reconnect' : 'Connect Google';
    $('#gOff').hidden = !g.connected;
    $('#gAccount').textContent = g.account ? 'Signed in as ' + g.account + ' · synced ' + when(g.lastSync) : '';
    $('#gPush').textContent = g.connected ? (g.pushActive ? 'Changes in Google arrive within seconds (push).' : g.push ? 'Push is set up when the next sync runs; until then the server checks every few minutes.' : 'The server checks Google every few minutes. With an https PUBLIC_URL it would get changes pushed instead.') : '';
    $('#gErr').textContent = g.error || '';
    pill($('#iStatus'), i.configured ? (i.error ? false : true) : undefined, i.configured ? (i.error ? 'Problem' : 'Connected') : 'Not set up');
    $('#iHelp').hidden = i.configured && !i.error;
    $('#iErr').textContent = i.configured ? (i.error || ('Signed in as ' + i.username + ' · synced ' + when(i.lastSync))) : '';
    $('#iErr').style.color = i.error ? '' : 'var(--ink-2)';

    const body = $('#cals'); body.replaceChildren();
    $('#empty').hidden = state.calendars.length > 0;
    for (const c of state.calendars) {
      const tr = el('tr'); tr.dataset.id = c.id;
      const show = el('input', { type: 'checkbox', className: 'sw', checked: c.enabled, ariaLabel: 'Show ' + c.name }); show.dataset.k = 'enabled';
      const name = el('input', { type: 'text', value: c.name, placeholder: c.sourceName }); name.dataset.k = 'name';
      const color = el('input', { type: 'color', className: 'color', value: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#246b5b' }); color.dataset.k = 'color';
      const who = el('div', { className: 'who' });
      for (const p of state.people) {
        const box = el('input', { type: 'checkbox', checked: c.personIds.includes(p.id), value: p.id });
        const lab = el('label', { className: box.checked ? 'on' : '' }, box, el('i'), p.name);
        lab.style.setProperty('--pc', p.color);
        box.onchange = () => lab.classList.toggle('on', box.checked);
        who.append(lab);
      }
      const meals = el('input', { type: 'checkbox', className: 'sw', checked: c.isMeals }); meals.dataset.k = 'isMeals';
      const def = el('input', { type: 'radio', name: 'default', className: 'sw', checked: state.defaultCalendarId === c.id, disabled: c.readOnly, value: c.id });
      tr.append(
        el('td', {}, show),
        el('td', {}, name, el('div', { className: 'src', textContent: (c.source === 'google' ? 'Google' : 'iCloud') + (c.readOnly ? ' · read-only' : '') + (c.primary ? ' · primary' : '') })),
        el('td', {}, color), el('td', {}, who), el('td', {}, meals), el('td', {}, def));
      body.append(tr);
    }
  }

  function collect() {
    const calendars = {};
    let defaultCalendarId;
    for (const tr of document.querySelectorAll('#cals tr')) {
      const q = (k) => tr.querySelector('[data-k="' + k + '"]');
      calendars[tr.dataset.id] = {
        enabled: q('enabled').checked,
        name: q('name').value.trim() || undefined,
        color: q('color').value,
        personIds: [...tr.querySelectorAll('.who input:checked')].map((b) => b.value),
        isMeals: q('isMeals').checked,
      };
      const r = tr.querySelector('input[type=radio]');
      if (r.checked) defaultCalendarId = r.value;
    }
    return { calendars, ...(defaultCalendarId ? { defaultCalendarId } : {}) };
  }

  const act = (btn, errNode, fn) => async () => {
    errNode.textContent = ''; btn.disabled = true;
    try { await fn(); } catch (e) { errNode.textContent = e.message; } finally { btn.disabled = false; }
  };
  $('#saveBtn').onclick = act($('#saveBtn'), $('#saveErr'), async () => { state = await call('POST', '/calendar/setup/prefs', collect()); render(); $('#saveErr').textContent = 'Saved.'; });
  $('#syncBtn').onclick = act($('#syncBtn'), $('#saveErr'), async () => { state = await call('POST', '/calendar/sync'); render(); });
  $('#gBtn').onclick = act($('#gBtn'), $('#gErr'), async () => {
    const r = await call('POST', '/calendar/google/start');
    if (state.google.pasteBack) { $('#gPaste').hidden = false; window.open(r.url, '_blank', 'noopener'); }
    else location.href = r.url;
  });
  $('#gFinish').onclick = act($('#gFinish'), $('#gErr'), async () => { state = await call('POST', '/calendar/google/finish', { url: $('#gUrl').value }); $('#gPaste').hidden = true; render(); });
  $('#gOff').onclick = act($('#gOff'), $('#gErr'), async () => { state = await call('POST', '/calendar/google/disconnect'); render(); });

  async function load() {
    if (!localStorage.getItem(KEY)) return showPair();
    try { state = await call('GET', '/calendar/setup/state'); render(); } catch (e) { $('#pairErr').textContent = e.message; }
  }
  load();
})();
</script>
</body>
</html>`;
