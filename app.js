/* ============================================================
   爸爸讲故事 · App 逻辑
   ============================================================ */
const CAT_EMOJI = {
  "童话故事": "🧸", "科普故事": "🔬", "成长故事": "🌱",
  "神话故事": "🐉", "历史故事": "📜", "成语故事": "🀄",
  "原创故事": "✨", "爸爸的仪式": "💛"
};

/* 爸爸的固定仪式 */
const RITUALS = [
  { id: "_ritual_hello", title: "开场报到", category: "爸爸的仪式", emoji: "👋",
    text: "宝宝，我是爸爸。爸爸下班了，来看看你。", keywords: ["每天一样", "固定开场白"] },
  { id: "_ritual_poem", title: "念首古诗 · 春晓", category: "爸爸的仪式", emoji: "🎋",
    text: "春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。宝宝，这是春天。", keywords: ["春晓", "孟浩然"] },
  { id: "_ritual_night", title: "晚安收尾", category: "爸爸的仪式", emoji: "🌙",
    text: "宝宝，今天到这儿。爸爸在，妈妈在。明天爸爸还来。晚安。", keywords: ["每天一样", "固定晚安语"] }
];

const $ = s => document.querySelector(s);
const el = {
  greet: $("#greet"), cats: $("#cats"), list: $("#list"), empty: $("#empty"),
  listTitle: $("#listTitle"), listCount: $("#listCount"), q: $("#q"), mic: $("#btnMic"),
  audio: $("#audio"), mini: $("#mini"), miniTitle: $("#miniTitle"), miniSub: $("#miniSub"),
  miniBar: $("#miniBar"), miniPlay: $("#miniPlay"), miniNext: $("#miniNext"), miniInfo: $("#miniInfo"),
  player: $("#player"), pTitle: $("#pTitle"), pCat: $("#pCat"), pKeywords: $("#pKeywords"),
  seek: $("#seek"), tCur: $("#tCur"), tDur: $("#tDur"), pPlay: $("#pPlay"),
  pPrev: $("#pPrev"), pNext: $("#pNext"), pBack: $("#pBack"), pFwd: $("#pFwd"),
  pSpeed: $("#pSpeed"), pLoop: $("#pLoop"), pText: $("#pText"), pTextWrap: $("#pTextWrap"),
  pTextBody: $("#pTextBody"), pBg: $("#pBg"), pClose: $("#pClose"), pLabel: $("#pLabel"),
  sheet: $("#sheet"), sheetMask: $("#sheetMask"), sheetOk: $("#sheetOk"), btnHow: $("#btnHow"),
  btnRandom: $("#btnRandom"), brandMark: $("#brandMark"),
  /* 装到桌面 / 离线下载（2026-09-30 加） */
  instBar: $("#instBar"), instGo: $("#instGo"), instX: $("#instX"),
  ibT: $("#ibT"), ibS: $("#ibS"),
  dlAll: $("#dlAll"), dlProg: $("#dlProg"), dlBar: $("#dlBar"), dlTxt: $("#dlTxt"),
  dlHint: $("#dlHint"),
  inappWarn: $("#inappWarn"), inappHd: $("#inappHd"), inappTx: $("#inappTx")
};

/* 跟 sw.js 里的 VER 保持一致，两边都改 */
const CACHE_NAME = "baba-v3";

/* 纯静态托管模式 ——
   整个 App 放在 GitHub Pages 上时是没有后端的，那些 /api/* 接口压根不存在。
   没有后端就别去问：只会拿到 404、在控制台刷红字，还白等重试。
   由 index.html 里的 <meta name="app-mode" content="static"> 标记。 */
const STATIC_MODE =
  (document.querySelector('meta[name="app-mode"]') || {}).content === "static";

let STORIES = [];
let view = [];
let READY_N = 0;
let curCat = "全部";
let curIdx = -1;
let queue = [];
let rate = 1.0;
let loopOne = false;

/* ---------- 工具 ---------- */
const fmt = t => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
};
const pickEmoji = s => s.emoji || CAT_EMOJI[s.category] || "📖";

/* ---------- 数据 ---------- */

/* 带重试的 JSON 拉取 ——
   公网隧道偶尔会回 503（或吐一个 HTML 错误页），一次失败就整个故事库变空，
   界面会显示"0 个"。这里自动重试几次，把这种抖动吃掉。

   404 是另一回事：它说明这个接口压根不存在（比如整个 App 托管成纯静态站时，
   根本没有后端提供 api/available）。重试毫无意义 —— 记下来，本次会话不再问它，
   省掉无谓的退避等待，也别在控制台刷红字。 */
const DEAD_SRC = new Set();

async function fetchJSON(url, tries = 4) {
  if (DEAD_SRC.has(url)) throw new Error("接口不存在，已跳过：" + url);
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) { DEAD_SRC.add(url); throw new Error("HTTP 404（接口不存在）"); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const txt = await r.text();
      const t = txt.trim();
      if (!t || t[0] === "<") throw new Error("不是 JSON（多半是隧道的错误页）");
      return JSON.parse(t);
    } catch (e) {
      lastErr = e;
      if (DEAD_SRC.has(url)) break;                 // 404 不重试
      if (i < tries - 1) await new Promise(res => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr || new Error("fetch failed");
}

async function load() {
  try {
    STORIES = await fetchJSON("data/stories.json");
  } catch (e) {
    console.error("故事库加载失败", e);
    STORIES = [];
  }

  // 问一下：哪些故事已经用爸爸的声音录好了
  // 两个来源取并集 ——
  //   ① data/available.json：静态清单，Service Worker 会缓存住，断网/我关机也能读
  //   ② api/available      ：服务端实时结果，合成过程中比静态清单更新得快
  const have = new Set();
  try {
    const j = await fetchJSON("data/available.json", 3);
    (j.list || []).forEach(n => have.add(n));
  } catch (e) {
    console.warn("静态音频清单读取失败（首次离线打开时属正常）", e);
  }
  // 纯静态托管下没有后端，跳过 —— 静态清单已经够用了
  if (!STATIC_MODE) {
    try {
      const j = await fetchJSON("api/available", 2);
      (j.list || []).forEach(n => have.add(n));
    } catch (e) {
      /* 断网时问不到，不是错误 —— 上面那份静态清单已经够了 */
    }
  }
  const mark = s => {
    s.audio = have.has(s.id + ".mp3") ? "audio/" + s.id + ".mp3" : "";
    s.ready = !!s.audio;
  };
  RITUALS.forEach(mark);
  STORIES.forEach(mark);

  STORIES = [...RITUALS, ...STORIES];
  READY_N = STORIES.filter(s => s.ready).length;
  const cats = ["全部", "爸爸的仪式", ...Object.keys(CAT_EMOJI).filter(c => c !== "爸爸的仪式" && STORIES.some(s => s.category === c))];
  el.cats.innerHTML = cats.map((c, i) =>
    `<button class="cat${i === 0 ? " on" : ""}" data-c="${c}">${c === "全部" ? "全部" : pickEmoji({ category: c }) + " " + c}</button>`
  ).join("");
  render();
  restoreLast();
  scheduleInstallBar();
  setupOfflineSection();
  if (!STORIES.length) toast("故事没加载出来，下拉刷新一下页面");
}

/* 离线到底能不能用，取决于打开 App 的那个地址算不算"安全来源"。
   iOS 上 http://192.168.x.x 不算（只有 https 和 localhost 算），
   Service Worker 注册不了，故事就存不进手机。
   与其让嫂子点了按钮没反应，不如提前把话说清楚。 */
function setupOfflineSection() {
  const canOffline = window.isSecureContext &&
    "serviceWorker" in navigator && "caches" in window;
  if (canOffline) return;

  el.dlAll.disabled = true;
  el.dlAll.textContent = "这个网址下暂时存不了";
  el.dlProg.hidden = true;
  if (el.dlHint) {
    el.dlHint.innerHTML = "现在这个地址是 <b>http 局域网</b>，苹果只允许 <b>https</b> 的页面把故事存进手机。" +
      "不过不影响用 —— 照上面三步装到桌面，在家连着 Wi-Fi 一样能听。";
  }
}

/* ---------- 渲染 ---------- */
function render() {
  const q = el.q.value.trim().toLowerCase();
  view = STORIES.filter(s => {
    if (curCat !== "全部" && s.category !== curCat) return false;
    if (!q) return true;
    const hay = (s.title + s.category + (s.keywords || []).join("") + (s.text || "")).toLowerCase();
    return hay.includes(q);
  });
  // 已经录好的排前面，方便老婆随手点开就能听
  view.sort((a, b) => (b.ready ? 1 : 0) - (a.ready ? 1 : 0));

  const readyInView = view.filter(s => s.ready).length;
  el.listTitle.textContent = q ? "搜索结果" : (curCat === "全部" ? "全部故事" : curCat);
  el.listCount.textContent = view.length
    ? (readyInView === view.length ? view.length + " 个" : "可听 " + readyInView + " / " + view.length)
    : "";
  el.empty.hidden = view.length > 0;

  el.list.innerHTML = view.map(s => {
    const playing = curIdx >= 0 && queue[curIdx] && queue[curIdx].id === s.id;
    return `<button class="item${playing ? " playing" : ""}${s.ready ? "" : " pending"}" data-id="${s.id}">
      <span class="it-ic">${pickEmoji(s)}</span>
      <span class="it-main">
        <span class="it-title">${esc(s.title)}</span>
        <span class="it-meta">${s.ready ? "" : '<b class="it-badge">录制中</b>'}${
          (s.keywords || []).slice(0, 3).map(k => esc(k)).join('<i>·</i>')
        }</span>
      </span>
      <svg class="it-go" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");
}
const esc = t => String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- 播放 ---------- */
function playById(id) {
  const i = view.findIndex(s => s.id === id);
  queue = view.slice();
  if (i >= 0) start(i);
}
function playRandom() {
  const pool = (curCat === "全部" ? STORIES.filter(s => s.category !== "爸爸的仪式") : view)
    .filter(s => s.ready);
  if (!pool.length) { toast("还没有录好的故事，等爸爸录完再来"); return; }
  queue = pool.slice();
  start(Math.floor(Math.random() * pool.length));
}
function playRitual(kind) {
  const map = { hello: "_ritual_hello", poem: "_ritual_poem", night: "_ritual_night" };
  const s = STORIES.find(x => x.id === map[kind]);
  if (!s) return;
  queue = [s]; start(0);
}

function start(i) {
  const s = queue[i];
  if (!s) return;
  if (!s.ready) { toast("《" + s.title + "》爸爸还在录，先听别的吧"); return; }
  curIdx = i;
  el.audio.src = s.audio;
  el.audio.playbackRate = rate;
  el.audio.loop = loopOne;
  el.audio.play().catch(err => {
    console.warn("播放失败", err);
    toast("这个故事的声音还没生成，换一个试试");
  });
  paint(s);
  render();
  saveLast(s.id);
}

function paint(s) {
  el.pTitle.textContent = s.title;
  el.pCat.textContent = pickEmoji(s);
  el.pKeywords.textContent = (s.keywords || []).join(" · ") || s.category;
  el.pTextBody.textContent = s.text || "";
  el.pLabel.textContent = s.category === "爸爸的仪式" ? "爸爸的声音" : "爸爸讲 · " + s.category;
  el.miniTitle.textContent = s.title;
  el.miniSub.textContent = s.category === "爸爸的仪式" ? "爸爸的声音" : "爸爸讲 · " + s.category;
  el.mini.hidden = false;
  el.player.hidden = false;
  el.pBg.style.setProperty("--glow", glowFor(s.category));
  mediaSession(s);
}
function glowFor(c) {
  const m = { "童话故事": "rgba(255,180,105,.30)", "科普故事": "rgba(124,196,255,.28)",
    "成长故事": "rgba(95,217,154,.26)", "神话故事": "rgba(200,140,255,.28)",
    "历史故事": "rgba(255,210,120,.26)", "成语故事": "rgba(255,140,140,.26)",
    "原创故事": "rgba(120,220,255,.26)", "爸爸的仪式": "rgba(255,180,105,.34)" };
  return m[c] || "rgba(255,180,105,.30)";
}

/* ---------- Media Session（锁屏控制） ---------- */
function mediaSession(s) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title, artist: "爸爸讲故事",
      album: s.category, artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }]
    });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    set("play", () => el.audio.play());
    set("pause", () => el.audio.pause());
    set("previoustrack", prev);
    set("nexttrack", next);
    set("seekbackward", d => el.audio.currentTime -= (d.seekOffset || 15));
    set("seekforward", d => el.audio.currentTime += (d.seekOffset || 15));
    set("seekto", d => { if (d.seekTime != null) el.audio.currentTime = d.seekTime; });
  } catch (e) {}
}

function step(dir) {
  if (!queue.length) return;
  for (let k = 1; k <= queue.length; k++) {
    const j = (((curIdx + dir * k) % queue.length) + queue.length) % queue.length;
    if (queue[j] && queue[j].ready) { start(j); return; }
  }
  toast("这些故事爸爸都还没录好呢");
}
function prev() { step(-1); }
function next() { step(1); }

/* ---------- 音频事件 ---------- */
el.audio.addEventListener("loadedmetadata", () => { el.tDur.textContent = fmt(el.audio.duration); });
el.audio.addEventListener("timeupdate", () => {
  const p = el.audio.duration ? (el.audio.currentTime / el.audio.duration) * 100 : 0;
  el.miniBar.style.width = p + "%";
  if (!seeking) { el.seek.value = p; }
  el.tCur.textContent = fmt(el.audio.currentTime);
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && el.audio.duration) {
    try { navigator.mediaSession.setPositionState({ duration: el.audio.duration, playbackRate: el.audio.playbackRate, position: el.audio.currentTime }); } catch (e) {}
  }
});
el.audio.addEventListener("play", () => {
  el.player.classList.add("playing"); el.mini.classList.add("playing");
  el.audio.loop = loopOne;
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
});
el.audio.addEventListener("pause", () => {
  el.player.classList.remove("playing"); el.mini.classList.remove("playing");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
});
el.audio.addEventListener("ended", () => { if (!loopOne) next(); });

/* 拖动进度 */
let seeking = false;
el.seek.addEventListener("input", () => { seeking = true; });
el.seek.addEventListener("change", () => {
  if (el.audio.duration) el.audio.currentTime = (el.seek.value / 100) * el.audio.duration;
  seeking = false;
});

/* ---------- 交互绑定 ---------- */
el.cats.addEventListener("click", e => {
  const b = e.target.closest(".cat"); if (!b) return;
  curCat = b.dataset.c;
  document.querySelectorAll(".cat").forEach(x => x.classList.toggle("on", x === b));
  render();
});
el.list.addEventListener("click", e => {
  const b = e.target.closest(".item"); if (!b) return;
  playById(b.dataset.id);
});
el.q.addEventListener("input", render);
el.btnRandom.addEventListener("click", playRandom);
el.miniPlay.addEventListener("click", () => el.audio.paused ? el.audio.play() : el.audio.pause());
el.pPlay.addEventListener("click", () => el.audio.paused ? el.audio.play() : el.audio.pause());
el.miniNext.addEventListener("click", next);
el.pNext.addEventListener("click", next);
el.pPrev.addEventListener("click", prev);
el.pBack.addEventListener("click", () => el.audio.currentTime -= 15);
el.pFwd.addEventListener("click", () => el.audio.currentTime += 15);
el.miniInfo.addEventListener("click", () => { el.player.hidden = false; });

el.pSpeed.addEventListener("click", () => {
  const opts = [1.0, 0.85, 0.7, 1.15];
  rate = opts[(opts.indexOf(rate) + 1) % opts.length];
  el.audio.playbackRate = rate;
  el.pSpeed.textContent = rate.toFixed(2).replace(/0$/, "") + "×";
  el.pSpeed.classList.toggle("on", rate !== 1.0);
});
el.pLoop.addEventListener("click", () => {
  loopOne = !loopOne; el.audio.loop = loopOne;
  el.pLoop.classList.toggle("on", loopOne);
});
el.pText.addEventListener("click", () => { el.pTextWrap.hidden = !el.pTextWrap.hidden; });
el.pTextWrap.addEventListener("click", () => { el.pTextWrap.hidden = true; });
el.pClose.addEventListener("click", () => { el.player.hidden = true; });

/* 仪式按钮 */
document.querySelectorAll(".ritual-btn").forEach(b =>
  b.addEventListener("click", () => playRitual(b.dataset.ritual)));

/* 说明 */
function openSheet() { el.sheet.hidden = false; }
function closeSheet() { el.sheet.hidden = true; if (instBarArmed) maybeShowInstBar(); }
el.btnHow.addEventListener("click", openSheet);
el.sheetMask.addEventListener("click", closeSheet);
el.sheetOk.addEventListener("click", closeSheet);
if (!localStorage.getItem("seen-howto")) {
  setTimeout(() => { openSheet(); localStorage.setItem("seen-howto", "1"); }, 1200);
}

/* ============================================================
   装到手机桌面（PWA 安装引导）
   —— iOS 没有安装包这条路，唯一免费又不过期的方式就是
      「Safari → 分享 → 添加到主屏幕」。装完桌面一个真图标、
      全屏、没有网址栏，点开直接就是 App。
   ============================================================ */
let instBarArmed = false;
let instBarShown = false;
let deferredPrompt = null;

function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/* 微信 / QQ / 微博……这些内置浏览器里装不了（没有「添加到主屏幕」这个入口）。
   最要命的是从微信点链接进来的场景 —— 不提前拦住，嫂子会一直找不到按钮。 */
const INAPP = (() => {
  const ua = navigator.userAgent;
  if (/MicroMessenger/i.test(ua)) return "微信";
  if (/QQ\//i.test(ua)) return "QQ";
  if (/Weibo/i.test(ua)) return "微博";
  if (/AlipayClient/i.test(ua)) return "支付宝";
  if (/DingTalk/i.test(ua)) return "钉钉";
  if (/Lark|Feishu/i.test(ua)) return "飞书";
  if (isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return "非 Safari 浏览器";
  return "";
})();

function applyInAppNotice() {
  if (!INAPP) return;
  el.inappWarn.hidden = false;
  el.inappHd.textContent = "⚠️ 现在是在" + INAPP + "里打开的，装不了";
  el.inappTx.innerHTML = INAPP === "微信"
    ? "请点右上角 <b>···</b>，选 <b>「在 Safari 中打开」</b>（或「在浏览器打开」），再按下面第 1 步做。"
    : "请点右上角 <b>···</b>，选 <b>「在浏览器打开」</b>，改用 <b>Safari</b> 再按下面第 1 步做。";
  el.ibT.textContent = "先换成 Safari 打开";
  el.ibS.textContent = INAPP + "里装不了，点右边看怎么做";
  el.instGo.textContent = "怎么办";
}

function scheduleInstallBar() {
  applyInAppNotice();
  // 首次打开会先弹"使用说明"，等它关掉再出提示条；老用户直接延迟一点出
  const firstTime = !localStorage.getItem("seen-howto");
  instBarArmed = true;
  if (INAPP) {
    // 微信里进来的，越早提醒越好
    setTimeout(() => maybeShowInstBar(), firstTime ? 4000 : 900);
  } else if (firstTime) {
    // 用户一直没关说明的话，也给个兜底，别让提示条永远不出现
    setTimeout(() => maybeShowInstBar(), 20000);
  } else {
    setTimeout(() => maybeShowInstBar(), 2200);
  }
}
function maybeShowInstBar() {
  if (instBarShown || isStandalone()) return;
  if (localStorage.getItem("hide-instbar")) return;
  instBarShown = true;
  el.instBar.hidden = false;
  document.body.classList.add("has-instbar");
}
function hideInstBar(remember) {
  el.instBar.hidden = true;
  document.body.classList.remove("has-instbar");
  if (remember) localStorage.setItem("hide-instbar", "1");
}

// Android / 桌面 Chrome 支持原生安装，抓住那个事件，点一下就装
window.addEventListener("beforeinstallprompt", e => {
  // ★ 微信等内置浏览器里根本装不了 —— 这里必须先退出，
  //   不能只是不显示提示条。否则 deferredPrompt 一旦被赋值，
  //   下面 instGo 的 click 就会以为"有原生安装可用"而提前 return，
  //   结果"怎么办"点了没反应（弹层打不开）。
  if (INAPP) return;
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem("hide-instbar")) { instBarShown = true; el.instBar.hidden = false; document.body.classList.add("has-instbar"); }
  el.instGo.textContent = "安装";
  el.instGo.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(() => ({}));
    if (r && r.outcome === "accepted") hideInstBar(true);
    deferredPrompt = null;
  };
});
window.addEventListener("appinstalled", () => {
  hideInstBar(true);
  toast("装好了！以后桌面点图标就能听");
});

// 默认（iOS）：按钮打开说明弹层里的三步指引
el.instGo.addEventListener("click", () => {
  if (deferredPrompt) return;   // 上面已接管
  openSheet();
  const b = document.querySelector(".sheet-body");
  if (INAPP) {
    // 微信里进来，重点是顶部那条"换 Safari 打开"，别往下滚
    if (b) b.scrollTop = 0;
  } else {
    const h = document.querySelector(".sheet-h3");
    if (h && h.scrollIntoView) h.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
el.instX.addEventListener("click", () => hideInstBar(true));

/* ============================================================
   把全部故事存到手机 —— 一次性写进缓存，之后断网也能听
   ============================================================ */
let downloading = false;
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on) {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } else if (wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch (e) { /* 不支持就算了，不挡下载 */ }
}

async function downloadAll() {
  if (downloading) return;

  const list = STORIES.filter(s => s.ready);
  if (!list.length) { toast("还没有录好的故事，等爸爸录完再来"); return; }

  if (!("caches" in window)) {
    toast("这个浏览器不支持离线保存，用 Safari 打开再试");
    return;
  }

  downloading = true;
  el.dlAll.disabled = true;
  el.dlProg.hidden = false;
  el.dlAll.textContent = "正在存…";
  await keepAwake(true);

  const cache = await caches.open(CACHE_NAME);
  let done = 0, ok = 0, fail = 0;
  const paint = () => {
    const pct = Math.round(done / list.length * 100);
    el.dlBar.style.width = pct + "%";
    el.dlTxt.textContent = `已存 ${done} / ${list.length} 条（${pct}%）`;
  };
  paint();

  for (const s of list) {
    try {
      const url = new URL(s.audio, location.href).href;
      if (!(await cache.match(url))) {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res.clone());
        else { fail++; done++; paint(); continue; }
      }
      ok++;
    } catch (e) {
      fail++;
    }
    done++;
    paint();
  }

  downloading = false;
  el.dlAll.disabled = false;
  await keepAwake(false);

  if (fail === 0) {
    el.dlBar.style.width = "100%";
    el.dlTxt.textContent = `${ok} 条全部存好，以后断网也能听`;
    el.dlAll.textContent = "已经全部存好了 ✓";
    toast("存好了！以后断网也能听");
  } else {
    el.dlTxt.textContent = `存好 ${ok} 条，还有 ${fail} 条没成功`;
    el.dlAll.textContent = "再存一次";
    toast(`存好 ${ok} 条，${fail} 条没成功，可能是手机空间不够或中途断网`);
  }
}
el.dlAll.addEventListener("click", downloadAll);

/* 语音搜索 */
el.mic.addEventListener("click", () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    el.q.focus();
    toast("点键盘上的话筒，说一句就行");
    return;
  }
  const r = new SR();
  r.lang = "zh-CN"; r.interimResults = false; r.maxAlternatives = 1;
  el.mic.classList.add("on");
  r.onresult = ev => { el.q.value = ev.results[0][0].transcript; render(); };
  r.onerror = () => toast("没听清，再说一次");
  r.onend = () => el.mic.classList.remove("on");
  try { r.start(); } catch (e) {}
});

/* 记忆上次 */
function saveLast(id) { try { localStorage.setItem("last", id); } catch (e) {} }
function restoreLast() {
  try {
    const id = localStorage.getItem("last");
    if (!id) return;
    const s = STORIES.find(x => x.id === id);
    if (!s || !s.ready) return;
    el.miniTitle.textContent = s.title;
    el.miniSub.textContent = s.category === "爸爸的仪式" ? "爸爸的声音" : "爸爸讲 · " + s.category;
    el.mini.hidden = false;
  } catch (e) {}
}

/* 提示条 */
let toastT;
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div"); t.id = "toast";
    t.style.cssText = "position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:300;background:rgba(30,26,40,.94);color:#eef3ff;font-size:13.5px;padding:11px 18px;border-radius:13px;border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);max-width:82vw;text-align:center;transition:.25s";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.style.opacity = "0"; }, 2200);
}

/* 品牌图标 */
el.brandMark.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 20s-6.5-4-6.5-8.5A3.5 3.5 0 0 1 12 9a3.5 3.5 0 0 1 6.5 2.5C18.5 16 12 20 12 20z"/><path d="M8 4.5v2M12 3.5v2.6M16 4.5v2"/></svg>`;

/* 启动 */
load();

/* Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
