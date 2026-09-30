/* Service Worker —— 应用外壳预缓存 + 音频离线缓存
   版本号改了要同步改 app.js 里的 CACHE_NAME（页面写缓存时用同一个桶） */
const VER = "baba-v3";
const SHELL = [
  "./", "./index.html", "./style.css", "./app.js",
  "./manifest.webmanifest",
  "./data/stories.json", "./data/available.json",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VER).then(async c => {
      // 逐个 add：某一个 404 不至于把整批预缓存拖垮（addAll 是原子的）
      await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* 「哪些录好了」这个接口：网络优先，断网时回退上一次的结果
     —— 否则 App 装到桌面、我一关机，全部故事都会被当成"还没录制" */
  if (url.pathname.endsWith("/api/available")) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const cp = res.clone();
          caches.open(VER).then(c => c.put(req, cp));
        }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || new Response(
        JSON.stringify({ ok: false, offline: true, list: [] }),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      )))
    );
    return;
  }

  /* 其余接口：永远走网络，不缓存（比如录音上传后的进度） */
  if (url.pathname.startsWith("/api/")) return;

  /* 音频：缓存优先（存过一次就离线可听） */
  if (url.pathname.includes("/audio/")) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const cp = res.clone();
          caches.open(VER).then(c => c.put(req, cp));
        }
        return res;
      }).catch(() => new Response("", { status: 404 })))
    );
    return;
  }

  /* 其余：网络优先，回退缓存（保证改版即时生效，离线也能开）
     ★ 注意：不能只靠 .catch()。隧道偶尔回 503 —— 那是个"成功的响应"，
       不会进 catch，于是错误页被原样吐给页面。必须显式处理 !res.ok。 */
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const cp = res.clone();
        caches.open(VER).then(c => c.put(req, cp));
        return res;
      }
      return caches.match(req).then(hit => hit || res);
    }).catch(() => caches.match(req).then(hit => {
      if (hit) return hit;
      // 只有导航请求才回退 index.html ——
      // 否则 JSON/JS/CSS 拿到一坨 HTML，解析会炸（踩过：故事库整个变空）
      if (req.mode === "navigate") return caches.match("./index.html").then(h => h || Response.error());
      return new Response("", { status: 504, statusText: "offline" });
    }))
  );
});

/* 页面可以喊一声让 SW 立刻接管（配合 app.js） */
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
