// Web / iPhone version of the catalog (owner 2026-11-10: «نسخه ios بساز و در همین لینک بزار»).
// Loaded before the page's own script. The Windows app has a Python server and Android a Java one; here the
// browser does their work: /api/... calls are answered in JavaScript, the account and the outbox live in this
// browser (localStorage), and orders go by the owner's Rubika bot. Rubika sends no CORS headers, so the order is
// posted as text/plain with mode "no-cors": it arrives (tested 2026-11-10 with getChat) but the page cannot
// read the answer, so a request that reached the network counts as sent.
// 2026-11-10: publishing the bot token in a public page was stopped, and the owner chose «Without the key»:
// an order or price offer opens the customer's own WhatsApp with the request written out, to the company number
// (BEHRAD_WEB.whatsapp). The message ends with the «#BCAT {json}» line, so forwarding it into the Rubika orders
// channel imports it into BehradCRM like an app order. Sign-up stays on this phone (no message).
(function () {
  const CFG = window.BEHRAD_WEB || {};
  const TAG = "#BCAT";
  const CHECK_EVERY = 60 * 1000;
  const K = {cat: "bc_catalog", meta: "bc_meta", acc: "bc_accounts", ses: "bc_session", box: "bc_requests", exp: "bc_expert"};
  const realFetch = window.fetch.bind(window);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };
  const json = obj => new Response(JSON.stringify(obj), {headers: {"Content-Type": "application/json"}});
  const pad = n => String(n).padStart(2, "0");
  const isoNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  function jalaliToday() {
    const g = new Date(), gy = g.getFullYear(), gm = g.getMonth() + 1, gd = g.getDate();
    const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
    let jy = -1595 + 33 * Math.floor(days / 12053);
    days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461;
    if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return `${jy}/${pad(jm)}/${pad(jd)}`;
  }

  // ------------------------------------------------------------ catalog (same site: ../catalog.json)
  let lastCheck = 0;
  const minute = () => Math.floor(Date.now() / 60000);
  async function fetchCatalog() {
    const r = await realFetch(`${CFG.base}catalog.json?t=${minute()}`, {cache: "no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const cat = await r.json();
    if (!Array.isArray(cat.products)) throw new Error("bad catalog");
    store.set(K.cat, cat) || store.set(K.cat, {...cat, products: cat.products.map(p => ({...p, description: "", specs: []}))});
    store.set(K.meta, {fetched: isoNow(), error: null});
    return cat;
  }
  async function catalog(force) {
    let cat = store.get(K.cat, null);
    const due = Date.now() - lastCheck >= CHECK_EVERY;
    if (force || !cat || due) {
      lastCheck = Date.now();
      try {
        if (force || !cat) cat = await fetchCatalog();
        else {  // a few bytes each minute; the whole catalog only when it changed (a new special sale)
          const v = await realFetch(`${CFG.base}version.txt?t=${minute()}`, {cache: "no-store"});
          if (v.ok && (await v.text()).trim() !== cat.updated) cat = await fetchCatalog();
        }
      } catch (e) {
        store.set(K.meta, {...store.get(K.meta, {}), error: String(e.message || e).slice(0, 200)});
      }
    }
    return json({catalog: cat, meta: {...store.get(K.meta, {}), today: jalaliToday()}});
  }

  // ------------------------------------------------------------ accounts (requests_box.py)
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
  async function hash(password, saltHex) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    return hex(await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt, iterations: 200000}, key, 256));
  }
  const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
  const digits = s => String(s || "").replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/\D/g, "");
  const pub = a => a ? {name: a.name, shop: a.shop, city: a.city, mobile: a.mobile} : null;
  const current = () => { const m = store.get(K.ses, {}).mobile; return m ? store.get(K.acc, {})[m] || null : null; };
  const fail = error => ({ok: false, error});

  async function signup(b) {
    const mobile = digits(b.mobile), [name, shop, city] = ["name", "shop", "city"].map(k => String(b[k] || "").trim().slice(0, 80));
    const password = String(b.password || "");
    if (!/^09\d{9}$/.test(mobile)) return fail("شماره موبایل درست نیست.");
    if (!name || !shop || !city) return fail("نام، نام فروشگاه و شهر را بنویسید.");
    if (password.length < 6) return fail("رمز باید حداقل ۶ حرف باشد.");
    const accounts = store.get(K.acc, {});
    if (accounts[mobile]) return fail("این شماره قبلاً روی این گوشی ثبت‌نام کرده است؛ از بخش «ورود» وارد شوید.");
    const salt = randHex(16);
    accounts[mobile] = {name, shop, city, mobile, salt, hash: await hash(password, salt), created: isoNow()};
    if (!store.set(K.acc, accounts)) return fail("مرورگر اجازه ذخیره نمی‌دهد (حالت خصوصی؟)؛ در حالت عادی باز کنید.");
    store.set(K.ses, {mobile});
    await add({type: "register"}, accounts[mobile]);
    return {ok: true};
  }
  async function login(b) {
    const mobile = digits(b.mobile), acc = store.get(K.acc, {})[mobile];
    if (!acc) return fail("حسابی با این شماره روی این گوشی نیست؛ اول ثبت‌نام کنید.");
    if (!b.password || (await hash(String(b.password), acc.salt)) !== acc.hash) return fail("رمز اشتباه است.");
    store.set(K.ses, {mobile});
    return {ok: true};
  }

  // ------------------------------------------------------------ sales expert («کد کارشناس», owner 2026-11-11)
  const experts = () => (store.get(K.cat, null) || {}).experts || {};
  function expert() {
    const e = store.get(K.exp, null);
    if (!e || !e.code) return null;
    return {code: e.code, name: experts()[e.code] || e.name || ""};
  }
  function setExpert(b) {
    const code = digits(b.code);
    if (code.length !== 4) return fail("کد کارشناس ۴ رقم است؛ آن را از کارشناس فروش خود بپرسید.");
    const list = experts();
    if (!Object.keys(list).length) return fail("فهرست کارشناسان هنوز دریافت نشده است؛ به اینترنت وصل شوید و دوباره امتحان کنید.");
    if (!list[code]) return fail("این کد کارشناس پیدا نشد. کد را دوباره بررسی کنید یا از کارشناس فروش خود بپرسید.");
    if (!store.set(K.exp, {code, name: list[code], at: isoNow()})) return fail("مرورگر اجازه ذخیره نمی‌دهد (حالت خصوصی؟)؛ در حالت عادی باز کنید.");
    return {ok: true, expert: {code, name: list[code]}};
  }

  // ------------------------------------------------------------ requests and Rubika
  const toman = v => { v = Number(v) || 0; return v >= 1e6 ? v : v * 1000; };
  const num = v => toman(v).toLocaleString("en-US").replace(/,/g, "٬");
  function text(item) {
    const c = item.customer;
    const head = {register: "🆕 ثبت‌نام همکار جدید", order: "🛒 درخواست سفارش", offer: "💬 پیشنهاد قیمت"}[item.type];
    const lines = [`${head} | کاتالوگ بهراد تجارت`, `👤 ${c.name} — ${c.shop} (${c.city})`, `📱 ${c.mobile}`];
    const e = item.expert || {};
    lines.push(e.code ? `🧑‍💼 کارشناس: ${e.name || "—"} (کد ${e.code})` : "🧑‍💼 کارشناس: کد وارد نشده");
    if (item.type !== "register") {
      lines.push(`📦 ${item.title}` + (item.color ? ` | رنگ: ${item.color}` : ""));
      lines.push(`🔢 تعداد: ${item.qty}`);
      if (item.offered) lines.push(`💰 قیمت پیشنهادی هر عدد: ${num(item.offered)} تومان`);
      if (item.list_price) lines.push(`🏷 قیمت ${item.sale ? "فروش ویژه" : "لیست"} امروز: ${num(item.list_price)} تومان`);
      if (item.note) lines.push(`📝 ${item.note}`);
    }
    lines.push(`🕒 ${item.when} · شماره ${item.id}`);
    const {status, sent_at, ...data} = item;
    lines.push(`${TAG} ${JSON.stringify(data)}`);
    return lines.join("\n");
  }
  function openWhatsApp(item) {
    const to = String(CFG.whatsapp || "").replace(/\D/g, "").replace(/^0/, "98");
    if (!to) return false;
    // navigation, not a pop-up: Safari never blocks it. Not wa.me: its redirect turned every emoji into «�» (tested)
    window.location.href = `https://api.whatsapp.com/send?phone=${to}&text=${encodeURIComponent(text(item))}`;
    return true;
  }
  async function add(item, acc) {
    const d = new Date();
    const full = {...item, id: "BC-" + randHex(4).toUpperCase(), at: isoNow(), when: `${jalaliToday()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
                  customer: pub(acc), expert: expert(), status: "queued"};
    if (full.type === "register") return "local";  // no server and no bot key: the account only lives on this phone
    if (openWhatsApp(full)) { full.status = "sent"; full.sent_at = isoNow(); }
    const box = store.get(K.box, []); box.push(full); store.set(K.box, box);
    return full.status;
  }
  async function request(b) {
    const acc = current();
    if (!acc) return fail("اول وارد حساب شوید.");
    if (!["order", "offer"].includes(b.type)) return fail("نوع درخواست نامعتبر است.");
    const qty = parseInt(b.qty || 0, 10);
    const offered = b.offered === null || b.offered === undefined || b.offered === "" ? null : parseInt(b.offered, 10);
    const listed = b.list_price === null || b.list_price === undefined || b.list_price === "" ? null : parseInt(b.list_price, 10);
    if (!(qty >= 1 && qty <= 10000) || (b.type === "offer" && !offered)) return fail("تعداد یا قیمت پیشنهادی را درست بنویسید.");
    const s = (k, n) => String(b[k] || "").slice(0, n);
    const status = await add({type: b.type, product_id: s("product_id", 20), brand: s("brand", 60), model: s("model", 120), title: s("title", 160),
      color: s("color", 40), qty, offered, list_price: listed, sale: !!b.sale, note: String(b.note || "").trim().slice(0, 800), list_date: s("date", 30)}, acc);
    return {ok: true, status};
  }
  function requests() {
    const acc = current();
    if (!acc) return {requests: []};
    return {requests: store.get(K.box, []).filter(x => x.type !== "register" && x.customer && x.customer.mobile === acc.mobile).reverse()};
  }

  // ------------------------------------------------------------ the page's /api calls
  window.fetch = async (input, opts) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api/")) return realFetch(input, opts);
    const path = url.split("?")[0], method = String((opts && opts.method) || "GET").toUpperCase();
    let body = {};
    try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (e) { body = {}; }
    if (path === "/api/catalog") return catalog(false);
    if (path === "/api/refresh") return catalog(true);
    if (path === "/api/account") return json({account: pub(current())});
    if (path === "/api/requests") return json(requests());
    if (path === "/api/expert" && method !== "POST") return json({expert: expert()});
    if (method === "POST") {
      if (path === "/api/signup") return json(await signup(body));
      if (path === "/api/login") return json(await login(body));
      if (path === "/api/logout") { store.del(K.ses); return json({ok: true}); }
      if (path === "/api/request") return json(await request(body));
      if (path === "/api/expert") return json(setExpert(body));
    }
    return new Response("", {status: 404});
  };

  // product card: share sheet on the phone («ذخیره در Photos»), else a download
  window.pywebview = {api: {save_png: async (dataUrl, name) => {
    const blob = await (await realFetch(dataUrl)).blob();
    const file = new File([blob], name, {type: "image/png"});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      try { await navigator.share({files: [file]}); return "«Save Image» را بزنید تا در گالری ذخیره شود"; } catch (e) { return null; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    return "در پوشه دانلودها";
  }}};

})();
