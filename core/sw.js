/* Heal hook, prepended to the engine's core/sw.js (scripts/push-engine.sh). Every copy's
   service worker (agent.js) imports that file from achroma-ubg/engine@latest, so this runs in
   every copy with an untouched worker: nothing on the copy's host is edited, and it only
   needs what the copy cannot do without (our engine and our API).

   It asks the API (/api/integrity, Origin = the copy's own origin) whether the copy's files
   are all official. The answer is cached; the API decides everything:
     mode "cache": the worker downloads the signed official build (m.json, hash-checked) into
                   Cache Storage and answers the copy's entry page and every file in the
                   build from it. The host's tampered files are never served again.
     mode "frame": the entry page becomes a full-window frame of an official link of the
                   same provider (a tampered CloudFront copy gets a CloudFront link).
   Silent either way: same address, nothing to click. Fails open: no answer, no change. */
(() => {
  if (globalThis.__achHealSw) return;
  globalThis.__achHealSw = true;
  const APIS = globalThis.__achHealApis || ['https://bikesense.org', 'https://api.streetdirectory.sg'];
  const SRCS = globalThis.__achHealSrcs || ['https://cdn.jsdelivr.net/gh/achroma-ubg/svg@latest/', 'https://fastly.jsdelivr.net/gh/achroma-ubg/svg@latest/',
    'https://gcore.jsdelivr.net/gh/achroma-ubg/svg@latest/', 'https://bikesense.org/ld/', 'https://api.streetdirectory.sg/ld/'];
  const KEYS = ['BF6fDhSmgskX8+HaG+ZZosthRofJdcIJSG2Ac7ge1AzO06aKsqUtOzJ0KU4SCjtxif649gUJ68Mi7eIKwRrm/Ss='];
  const STATE = 'achroma-heal-state';
  const FRESH = 30 * 60e3;
  const TYPES = { js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2',
    wasm: 'application/wasm', mp4: 'video/mp4', txt: 'text/plain; charset=utf-8', gif: 'image/gif', ico: 'image/x-icon', mp3: 'audio/mpeg' };
  const origin = self.location.origin;
  const base = () => new URL(self.registration.scope).pathname;
  const stateKey = () => origin + base() + '__achroma_heal__';

  let v = null, loaded = null, running = null;   // v: { t, ok } | { t, ok:false, mode, link, homes, ver, files, doc }
  const load = () => loaded || (loaded = caches.open(STATE).then((c) => c.match(stateKey())).then((r) => r && r.json()).then((s) => { v = s || null; }).catch(() => {}));
  const save = () => caches.open(STATE).then((c) => c.put(stateKey(), new Response(JSON.stringify(v)))).catch(() => {});

  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64 = (buf) => { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
  const sha = async (buf) => b64(await crypto.subtle.digest('SHA-256', buf));
  async function signed(text, sig) {
    const data = new TextEncoder().encode(text);
    for (const k of KEYS) {
      try {
        const key = await crypto.subtle.importKey('raw', unb64(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(sig.trim()), data)) return true;
      } catch {}
    }
    return false;
  }
  const timed = (url, opt, ms) => fetch(url, { ...opt, signal: AbortSignal.timeout(ms) });

  async function ask() {
    for (const api of APIS) {
      try {
        const r = await timed(api + '/api/integrity?page=' + encodeURIComponent(origin + '/') + '&quick=1', { cache: 'no-store', credentials: 'omit' }, 30000);
        if (r.ok) return await r.json();
      } catch {}
    }
    return null;
  }
  async function manifest() {
    for (const s of SRCS) {
      try {
        const r = await timed(s + 'm.json', { cache: 'no-store', credentials: 'omit' }, 10000);
        if (!r.ok) continue;
        const j = await r.json();
        if (!(await signed(j.m, j.s))) continue;
        const m = JSON.parse(j.m);
        if (m.v === 1 && m.files && /^[0-9a-f]{40}$/.test(m.ref)) return m;
      } catch {}
    }
    throw new Error('no manifest');
  }
  async function fetchChecked(bases, path, hash) {
    for (const b of bases) {
      try {
        const r = await timed(b + path, { cache: 'reload', credentials: 'omit' }, 60000);
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        if ((await sha(buf)) === hash) return buf;
      } catch {}
    }
    throw new Error('file ' + path);
  }
  async function install() {
    const m = await manifest(), ver = m.ref.slice(0, 12), name = 'achroma-heal-' + ver;
    if (v && v.ver === ver && (await caches.has(name))) return v;
    const paths = Object.keys(m.files), bases = SRCS.map((s) => s.replace('@latest/', '@' + m.ref + '/'));
    await caches.delete(name);
    const cache = await caches.open(name);
    let next = 0;
    const lane = async () => {
      while (next < paths.length) {
        const p = paths[next++];
        const buf = await fetchChecked(bases, p, m.files[p][0]);
        await cache.put(new Request(origin + base() + p), new Response(buf, { headers: { 'content-type': TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream' } }));
      }
    };
    await Promise.all([lane(), lane(), lane(), lane(), lane(), lane()]);
    for (const k of await caches.keys()) if (k.startsWith('achroma-heal-') && k !== name && k !== STATE) await caches.delete(k);
    return { ver, files: paths, doc: (m.docs && m.docs[0]) || 'app.svg' };
  }
  const markHealed = () => APIS.forEach((a) => { fetch(a + '/api/healed', { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true }).catch(() => {}); });

  function refresh() {
    if (running) return running;
    running = (async () => {
      await load();
      const r = await ask();
      if (!r) { if (!v) v = { t: Date.now() - FRESH + 5 * 60e3, ok: true }; return save(); }   // no answer: carry on, ask again in 5 min
      // pending = clean so far, the API is still reading the copy's files: ask again in a minute
      if (r.ok !== false) { v = { t: r.pending ? Date.now() - FRESH + 60e3 : Date.now(), ok: true }; return save(); }
      const next = { t: Date.now(), ok: false, mode: r.mode === 'cache' ? 'cache' : 'frame', link: r.link && r.link.url, homes: r.homes || [] };
      if (next.mode === 'cache') {
        try { Object.assign(next, await install()); markHealed(); } catch { next.mode = 'frame'; }   // could not fetch the official build: frame instead
      }
      v = next;
      return save();
    })().catch(() => {}).finally(() => { running = null; });
    return running;
  }

  const isEntry = (url) => {
    const rel = url.pathname.slice(base().length);
    return url.pathname.startsWith(base()) && (rel === '' || /^(index|app)\.(svg|html?)$/.test(rel));
  };
  const frameDoc = (link) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Achroma</title>'
    + '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style><iframe id="f" allowfullscreen '
    + 'allow="fullscreen; autoplay; clipboard-read; clipboard-write; display-capture; picture-in-picture; gamepad; pointer-lock; keyboard-map; microphone; camera"></iframe>'
    + '<script>var f=document.getElementById("f");f.src=' + JSON.stringify(link).replace(/</g, '\\u003c') + '+location.hash;'
    + 'addEventListener("message",function(e){var t=e.source===f.contentWindow&&e.data&&e.data.achromaTab;if(t&&typeof t.title==="string")document.title=t.title})</script>',
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

  addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== origin) return;
    if (req.mode === 'navigate' && isEntry(url)) {
      e.respondWith((async () => {
        await load();
        if (!v || Date.now() - v.t > FRESH) {
          // first look (or stale): wait for the verdict, but never hold the page up: a copy we already know answers at once, a new one is judged for its next load
          const p = refresh();
          if (!v) await Promise.race([p, new Promise((r) => setTimeout(r, 2500))]); else e.waitUntil(p);
        }
        if (v && v.ok === false) {
          if (v.mode === 'cache' && v.ver) {
            const hit = await (await caches.open('achroma-heal-' + v.ver)).match(origin + base() + v.doc);
            if (hit) { markHealed(); return hit; }
          }
          const link = [v.link, ...(v.homes || [])].find((l) => /^https:\/\//.test(l || ''));
          if (link) return frameDoc(link);
        }
        return fetch(req);
      })());
      return;
    }
    // healed from the cache: every file of the official build comes from the snapshot
    if (v && v.ok === false && v.mode === 'cache' && v.ver && url.pathname.startsWith(base()) && v.files.includes(decodeURIComponent(url.pathname.slice(base().length)))) {
      e.respondWith(caches.open('achroma-heal-' + v.ver).then((c) => c.match(origin + url.pathname)).then((r) => r || fetch(req)));
    }
  });
  addEventListener('activate', (e) => e.waitUntil(refresh()));
  addEventListener('message', (e) => {
    if (e.data && e.data.achromaHeal === 'check') {
      const src = e.source;
      e.waitUntil(refresh().then(() => src && src.postMessage({ achromaHeal: 'done', healed: !!(v && v.ok === false), mode: v && v.mode })));
    }
  });
  load();
})();

var $netCtl;
(() => {
var __webpack_modules__ = ({
"./packages/rpc/index.ts"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  RpcHelper: () => (RpcHelper)
});
class RpcHelper {
    methods;
    id;
    sendRaw;
    counter = 0;
    promiseCallbacks = new Map();
    constructor(methods, id, sendRaw){
        this.methods = methods;
        this.id = id;
        this.sendRaw = sendRaw;
    }
    recieve(data) {
        if (data === undefined || data === null || typeof data !== "object") return;
        const dt = data[this.id];
        if (dt === undefined || dt === null || typeof dt !== "object") return;
        const type = dt.$type;
        if (type === "response") {
            const token = dt.$token;
            const data = dt.$data;
            const error = dt.$error;
            const cb = this.promiseCallbacks.get(token);
            if (!cb) return;
            this.promiseCallbacks.delete(token);
            if (error !== undefined) {
                cb.reject(new Error(error));
            } else {
                cb.resolve(data);
            }
        } else if (type === "request") {
            const method = dt.$method;
            const args = dt.$args;
            this.methods[method](args).then((r)=>{
                this.sendRaw({
                    [this.id]: {
                        $type: "response",
                        $token: dt.$token,
                        $data: r?.[0]
                    }
                }, r?.[1]);
            }).catch((err)=>{
                console.error(err);
                this.sendRaw({
                    [this.id]: {
                        $type: "response",
                        $token: dt.$token,
                        $error: err?.toString() || "Unknown error"
                    }
                }, []);
            });
        }
    }
    call(method, args, transfer = []) {
        const token = this.counter++;
        return new Promise((resolve, reject)=>{
            this.promiseCallbacks.set(token, {
                resolve,
                reject
            });
            this.sendRaw({
                [this.id]: {
                    $type: "request",
                    $method: method,
                    $args: args,
                    $token: token
                }
            }, transfer);
        });
    }
}


},

});
// The module cache
var __webpack_module_cache__ = {};

// The require function
function __webpack_require__(moduleId) {

// Check if module is in cache
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
// Create a new module (and put it into the cache)
var module = (__webpack_module_cache__[moduleId] = {
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

// webpack/runtime/define_property_getters
(() => {
__webpack_require__.d = (exports, definition) => {
	for(var key in definition) {
        if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
            Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
        }
    }
};
})();
// webpack/runtime/has_own_property
(() => {
__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
})();
// webpack/runtime/make_namespace_object
(() => {
// define __esModule on exports
__webpack_require__.r = (exports) => {
	if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
	}
	Object.defineProperty(exports, '__esModule', { value: true });
};
})();
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  route: () => (route),
  shouldRoute: () => (shouldRoute)
});
/* import */ var _mercuryworkshop_rpc__rspack_import_0 = __webpack_require__("./packages/rpc/index.ts");
/// <reference lib="WebWorker" />
/// <reference types="@types/serviceworker" />

function makeId() {
    return Math.random().toString(36).substring(2, 10);
}
const cookieResolvers = {};
addEventListener("message", (e)=>{
    if (!e.data) return;
    if (typeof e.data != "object") return;
    if (e.data.$sw$setCookieDone && typeof e.data.$sw$setCookieDone == "object") {
        const done = e.data.$sw$setCookieDone;
        const resolver = cookieResolvers[done.id];
        if (resolver) {
            resolver();
            delete cookieResolvers[done.id];
        }
    }
    if (e.data.$sw$initRemoteTransport && typeof e.data.$sw$initRemoteTransport == "object") {
        const { port, prefix } = e.data.$sw$initRemoteTransport;
        const relevantcontroller = tabs.find((tab)=>new URL(prefix).pathname.startsWith(tab.prefix));
        if (!relevantcontroller) {
            console.error("No relevant controller found for transport init");
            return;
        }
        relevantcontroller.rpc.call("initRemoteTransport", port, [
            port
        ]);
    }
});
class ControllerReference {
    prefix;
    id;
    rpc;
    constructor(prefix, id, port){
        this.prefix = prefix;
        this.id = id;
        this.rpc = new _mercuryworkshop_rpc__rspack_import_0.RpcHelper({
            sendSetCookie: async ({ cookies, options })=>{
                const clients1 = await self.clients.matchAll();
                const ids = [];
                const promises = [];
                // Navigation fetches (document/iframe) deliver cookies via the inject
                // script's embedded cookieJar dump — the destination page doesn't have
                // inject.ts loaded yet to ack, so awaiting would deadlock. Broadcast
                // so any already-loaded clients can update their jars, but don't wait.
                const isNavigation = options?.destination === "document" || options?.destination === "iframe";
                for (const client of clients1){
                    const id = makeId();
                    ids.push(id);
                    client.postMessage({
                        $controller$setCookie: {
                            cookies,
                            options,
                            id
                        }
                    });
                    if (!isNavigation) {
                        promises.push(new Promise((resolve)=>{
                            // Resolve with the id so we know which client replied.
                            cookieResolvers[id] = ()=>resolve(id);
                        }));
                    }
                }
                // Wait for the first client to acknowledge the cookie sync.
                // Using Promise.any (not Promise.all) so that extra SW clients created by
                // window.open (e.g. test popup windows) don't cause timeouts — only the
                // main controller client needs to respond.
                if (promises.length > 0) {
                    let timeoutId;
                    let responded = false;
                    const timeoutPromise = new Promise((resolve)=>{
                        timeoutId = setTimeout(()=>{
                            if (!responded) {
                                const pending = ids.filter((id)=>cookieResolvers[id] !== undefined);
                                console.error("timed out waiting for set cookie response (deadlock?): " + `cookies=${cookies.length} clients=${clients1.length} ` + `pending=${pending.length}/${ids.length} ` + `clientUrls=${clients1.map((c)=>c.url).join(",")}`);
                            }
                            resolve();
                        }, 1000);
                    });
                    try {
                        await Promise.race([
                            timeoutPromise,
                            Promise.any(promises).then(()=>{
                                responded = true;
                            }).catch(()=>{})
                        ]);
                    } finally{
                        // Clear the timeout so it doesn't fire spuriously after the
                        // race has already been won by Promise.any.
                        if (timeoutId !== undefined) clearTimeout(timeoutId);
                        // Clean up any pending resolvers so clients that never
                        // responded don't leak entries in cookieResolvers.
                        for (const id of ids){
                            delete cookieResolvers[id];
                        }
                    }
                }
            }
        }, "tabchannel-" + id, (data, transfer)=>{
            port.postMessage(data, transfer);
        });
        port.onmessage = (e)=>{
            this.rpc.recieve(e.data);
        };
        port.onmessageerror = console.error;
        this.rpc.call("ready", undefined);
    }
}
const tabs = [];
// --- self-heal: tolerate SW restarts mid-session ---------------------------------
// The SW can be killed while idle (browser reclamation, SW update) and woken by a
// proxied fetch. tabs[] is rebuilt only when clients re-send $controller$init, so
// a fetch racing (or losing) that wake-up would 404 against the static server.
// When a /~/sj/ request matches no tab, we ping every client to re-register.
function tabForPathname(pathname) {
    return tabs.find((tab)=>pathname.startsWith(tab.prefix));
}
let lastRevivePing = 0;
function requestRevive() {
    const now = Date.now();
    if (now - lastRevivePing < 500) return; // debounce: all subresources of one page
    lastRevivePing = now;
    console.warn("[proxy] proxied fetch with no registered tab — requesting re-init");
    clients.matchAll().then((all)=>{
        for (const client of all) client.postMessage({
            $sdk$swrevive: { registered: tabs.map((t)=>t.id) }
        });
    });
}
// ---------------------------------------------------------------------------------
addEventListener("message", (e)=>{
    if (!e.data) return;
    if (typeof e.data != "object") return;
    if (!e.data.$controller$init) return;
    if (typeof e.data.$controller$init != "object") return;
    const init = e.data.$controller$init;

    const existing = tabs.findIndex((t)=>t.id === init.id);
    if (existing !== -1) {
        tabs.splice(existing, 1);
    }
    tabs.push(new ControllerReference(init.prefix, init.id, e.ports[0]));
});
function shouldRoute(event) {
    const url = new URL(event.request.url);
    const tab = tabForPathname(url.pathname);
    // Under the SW's own scope, so builds served from a subfolder heal too.
    if (!tab && url.pathname.startsWith(new URL(self.registration.scope).pathname + "~/sj/")) {
        // Tab registry is empty/stale (SW restart race): wake the client so it
        // re-sends $controller$init. This fetch itself may still 404 — the next
        // attempt succeeds, and self-repairing loads recover automatically.
        requestRevive();
    }
    return tab !== undefined;
}
// Error page shown in place of a page that failed to load through the
// proxy — connection/SSL/DNS failures (which throw) and failed top-level
// navigations (404 / 5xx responses). Subresource failures never see this:
// a missing image or script must not replace the whole page.
function isTopNavigation(event) {
    // "iframe" is the important one here: proxied pages live in iframes, so
    // their navigations arrive with destination "iframe", not "document".
    return event.request.mode === "navigate"
        || event.request.destination === "document"
        || event.request.destination === "iframe";
}
function errorPage(detail) {
    const safe = String(detail ?? "unknown error")
        .replace(/[<>&"]/g, (c) => ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;"
        }[c]));
    // A Settings-style card (settings.css .settings-card / -header / -row):
    // "ERROR" header, then one row with the explanation on the left and the
    // raw error on the right (stacked below on narrow frames). Centred with
    // margin:auto so a tall card scrolls instead of being cut off.
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Failed to load — achroma</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Roboto:wght@500&display=swap" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%;background:transparent;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:rgba(255,255,255,.92)}
body{display:flex;min-height:100vh;padding:20px;overflow:auto}
.card{margin:auto;width:100%;max-width:760px;padding:4px 0 0;background:rgba(6,6,6,.72);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.1);border-radius:14px}
.head{padding:12px 18px 4px;font:500 11px Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.4)}
.row{display:flex;align-items:stretch;gap:28px;padding:10px 18px 22px}
.text{flex:1;min-width:0}
h1{font-size:17px;font-weight:600;letter-spacing:-.01em;color:rgba(255,255,255,.95)}
p{margin-top:6px;font-size:13px;line-height:1.5;color:rgba(255,255,255,.5)}
ul{margin-top:12px;list-style:none;display:flex;flex-direction:column;gap:8px}
li{position:relative;padding-left:16px;font-size:13px;line-height:1.45;color:rgba(255,255,255,.72)}
li::before{content:"";position:absolute;left:3px;top:.55em;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.35)}
code{flex:0 1 46%;min-width:0;min-height:150px;max-height:220px;overflow:auto;padding:9px 12px;background:#000;border:1px solid rgba(255,255,255,.14);border-radius:12px;font:12px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:rgba(255,255,255,.75);white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
@media (max-width:560px){.row{flex-direction:column;gap:16px}code{flex:none;min-height:0;max-height:160px}}
</style></head><body><section class="card"><h2 class="head">Error</h2><div class="row"><div class="text"><h1>Uh oh!</h1><p>Achroma hit a problem whilst trying to load this page. Try these steps:</p><ul><li>Refresh the page</li><li>Check your internet connection</li><li>Try again in a few minutes, the site may be down</li><li>Contact the site administrator if it keeps happening</li></ul></div><code>${safe}</code></div></section></body></html>`;
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}
// Wait briefly for a tab to (re)register after a revive ping — this covers the
// SW-restart race where the waking fetch arrives before the client's
// $controller$init handshake lands. Returns the tab or null.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tabAwaiting(pathname, timeoutMs = 5000) {
    let tab = tabForPathname(pathname);
    if (tab) return tab;
    requestRevive();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(100);
        tab = tabForPathname(pathname);
        if (tab) return tab;
    }
    return null;
}
async function route(event) {
    try {
        const url = new URL(event.request.url);
        let tab = tabForPathname(url.pathname);
        if (!tab) {
            // No registered tab for this prefix — likely a freshly restarted SW.
            // Give the client a moment to re-handshake before giving up.
            tab = await tabAwaiting(url.pathname);
            if (!tab) {
                throw new Error("no proxy session for this tab (stale or restarted service worker)");
            }
        }
        const client = await clients.get(event.clientId);
        const rawheaders = [
            ...event.request.headers
        ];
        const response = await tab.rpc.call("request", {
            rawUrl: event.request.url,
            rawReferrer: event.request.referrer,
            destination: event.request.destination,
            mode: event.request.mode,
            referrer: event.request.referrer,
            method: event.request.method,
            body: event.request.body,
            cache: event.request.cache,
            forceCrossOriginIsolated: false,
            initialHeaders: rawheaders,
            rawClientUrl: client ? client.url : undefined,
            clientId: event.clientId || event.resultingClientId
        }, event.request.body instanceof ReadableStream || // @ts-expect-error the types for fetchevent are messed up
        event.request.body instanceof ArrayBuffer ? [
            event.request.body
        ] : undefined);
        // Failed page loads (404 / 5xx / transport-reported status 0) swap in
        // the error page; the real response is untouched otherwise.
        if (isTopNavigation(event) && (response.status === 0 || response.status === 404 || response.status >= 500)) {
            console.warn("Page failed to load:", response.status, response.statusText);
            return errorPage(`${response.status}${response.statusText ? " " + response.statusText : ""}`);
        }
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });
    } catch (e) {
        console.error("Service Worker error:", e);
        // Connection/SSL/DNS failures land here — render the error page for
        // top-level navigations, keep the bare error for subresources.
        if (isTopNavigation(event)) {
            return errorPage(e.message || String(e));
        }
        return new Response("Internal Service Worker Error: " + e.message, {
            status: 500
        });
    }
}
addEventListener("install", ()=>{
    self.skipWaiting();
});
addEventListener("activate", (event)=>{
    event.waitUntil(clients.claim());
});
// the only way to know if a service worker has suddenly died is if this code runs again
// notify all clients to send over their messageports again
setTimeout(async ()=>{
    console.log("service worker activated, notifying clients to revive");
    for (const client of (await clients.matchAll())){
        client.postMessage({
            $sdk$swrevive: { registered: tabs.map((t)=>t.id) }
        });
    }
// short delay is apparently needed
}, 100);

})();

$netCtl = __webpack_exports__;
})()
;
