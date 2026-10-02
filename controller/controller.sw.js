var $corridorController;
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
    console.warn("[corridor] proxied fetch with no registered tab — requesting re-init");
    clients.matchAll().then((all)=>{
        for (const client of all) client.postMessage({
            $controller$swrevive: {}
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Failed to load — achroma</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap" rel="stylesheet"><style>html,body{margin:0;height:100%;background:transparent;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{display:flex;align-items:center;justify-content:center}.wrap{text-align:center;padding:24px;max-width:560px}h1{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;font-size:28px;font-weight:700;margin:0 0 10px}p{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:rgba(255,255,255,.55);font-size:14px;line-height:1.6;margin:0 0 18px}code{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:rgba(255,255,255,.75);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;max-width:100%;word-break:break-all;text-align:left}</style></head><body><div class="wrap"><h1>Uh oh!</h1><p>Something failed, and achroma failed to load the page. Try refreshing.</p><code>${safe}</code></div></body></html>`;
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
async function tabAwaiting(pathname, timeoutMs = 2500) {
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
            $controller$swrevive: {}
        });
    }
// short delay is apparently needed
}, 100);

})();

$corridorController = __webpack_exports__;
})()
;
//# sourceMappingURL=controller.sw.js.map
