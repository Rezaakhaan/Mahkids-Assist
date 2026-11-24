/* Mahkids Assist - service worker
   استراتژی: «اول کش». برنامه همیشه فوری از حافظه باز می‌شود (حتی با اینترنت ضعیف یا قطع)،
   و نسخهٔ تازه پشت‌صحنه گرفته می‌شود. هیچ‌وقت منتظر شبکه نمی‌ماند. */
var VER = 'v' + (new URL(self.location.href).searchParams.get('v') || '0');   // شماره از index.html (APP_VER) می‌آید
var CACHE = 'mahkids-assist-' + VER;
var CORE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-180.png'];
var OPTIONAL = ['fonts/Vazirmatn-var.woff2'];   // اگر فایل نبود، نصب خراب نمی‌شود

function fresh(u) { return new Request(u, { cache: 'reload' }); }

/* ---- اعتبارسنجی پاسخ قبل از کش‌کردن (v14) ----
   هات‌اسپات/فیلتر گاهی به‌جای فایل، صفحهٔ ورود یا خطا با کد ۲۰۰ برمی‌گرداند.
   چنین پاسخی نباید نسخهٔ سالم کش را بازنویسی کند. */
var MARK = 'Mahkids Assist';
function isDocReq(req) { return req.mode === 'navigate' || /(\/|index\.html)$/.test(new URL(req.url).pathname); }
function typeOk(path, ct, doc) {
  ct = (ct || '').toLowerCase();
  if (doc) return ct === '' || ct.indexOf('text/html') >= 0;
  if (ct.indexOf('text/html') >= 0) return false;            // صفحهٔ ورود/خطا به‌جای فایل
  if (/\.png$/.test(path)) return ct === '' || ct.indexOf('image/') === 0;
  if (/\.(json|webmanifest)$/.test(path)) return ct === '' || /json|manifest/.test(ct);
  if (/\.js$/.test(path)) return ct === '' || /javascript|ecmascript/.test(ct);
  if (/\.woff2?$/.test(path)) return ct === '' || /font|woff|octet-stream/.test(ct);
  return true;
}
function good(req, r) {
  if (!r || r.status !== 200 || r.type === 'opaque' || r.type === 'opaqueredirect') return Promise.resolve(false);
  try { if (r.redirected && new URL(r.url).origin !== self.location.origin) return Promise.resolve(false); } catch (e) {}
  var doc = isDocReq(req), path = new URL(req.url).pathname;
  if (!typeOk(path, r.headers.get('content-type'), doc)) return Promise.resolve(false);
  if (!doc) return Promise.resolve(true);
  return r.clone().text().then(function (t) { return t.indexOf(MARK) >= 0; }, function () { return false; });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) {
      var rq = fresh(u);
      return fetch(rq).then(function (r) {
        return good(rq, r).then(function (ok) { if (!ok) throw new Error('bad response: ' + u); return c.put(rq, r); });
      });
    })).then(function () {
      return Promise.all(OPTIONAL.map(function (u) {
        var rq = fresh(u);
        return fetch(rq).then(function (r) { return good(rq, r).then(function (ok) { return ok ? c.put(rq, r) : null; }); }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (k) {
      return Promise.all(k.filter(function (x) { return x.indexOf('mahkids-assist-') === 0 && x !== CACHE; })
        .map(function (x) { return caches.delete(x); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function tell(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (l) {
    l.forEach(function (c) { c.postMessage(msg); });
  });
}

// گرفتن نسخهٔ تازه از شبکه (با مهلت)، ذخیره در کش و اطلاع‌دادن اگر index.html عوض شده باشد
function revalidate(req, cached) {
  var ac = typeof AbortController === 'function' ? new AbortController() : null;
  var t = ac ? setTimeout(function () { ac.abort(); }, 20000) : 0;
  return fetch(req, ac ? { signal: ac.signal, cache: 'no-cache' } : { cache: 'no-cache' }).then(function (r) {
    clearTimeout(t);
    return good(req, r).then(function (valid) {
      if (!valid) return;                                   // پاسخ نامعتبر: کش سالم دست‌نخورده می‌ماند
      var isDoc = isDocReq(req);
      var copy = r.clone();
      var changed = isDoc && cached ? Promise.all([cached.text(), r.clone().text()]).then(function (p) { return p[0] !== p[1]; }) : Promise.resolve(false);
      return changed.then(function (ch) {
        return caches.open(CACHE).then(function (c) { return c.put(req, copy); }).then(function () { /* کمی صبر تا صفحه کامل باز شده باشد */ if (ch) return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return tell({ type: 'UPDATED' }); }); });
      });
    });
  }).catch(function () { clearTimeout(t); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // فقط فایل‌های خود برنامه
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = revalidate(req, hit ? hit.clone() : null);   // نسخهٔ جدا برای مقایسه (بدنهٔ hit به صفحه می‌رود)
        if (hit) { e.waitUntil(net); return hit; }       // فوری از کش
        // در کش نبود: شبکه را امتحان کن، شکست خورد به صفحهٔ اصلی برگرد
        return fetch(req).then(function (r) {
          return good(req, r).then(function (ok) { if (ok) c.put(req, r.clone()); return r; });
        }).catch(function () {
          if (req.mode === 'navigate') return c.match('index.html');
          return new Response('', { status: 503, statusText: 'offline' });
        });
      });
    })
  );
});
