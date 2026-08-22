/**
 * ------------------------------------------
 * @Date: 2026.08.22
 * @Description: Sigma 卡路里抢兑 — 拦截已签名兑换请求快速重放
 * @Author: Adapted from Sliverkiss template
 * ------------------------------------------
 * new Env("Sigma卡路里抢兑");
 * 脚本兼容：Surge、QuantumultX、Loon、Shadowrocket，不支持青龙
 *
 * [rewrite_local]
 * ^https:\/\/[^\/]+\/quidd\/kcal\/act\/home url script-response-body sigma_seckill.js
 * ^https:\/\/[^\/]+\/quidd\/kcal\/act\/redeem$ url script-request-body sigma_seckill.js
 *
 * [MITM]
 * hostname = as.sigma.run, api.sigma.run
 *
 * ⚠️【免责声明】
 * ------------------------------------------
 * 1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
 * 2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
 * 3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
 * 4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
 * 5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
 * 6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
 * 7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
 */
const $ = new Env("Sigma卡路里抢兑");
//notify
const notify = $.isNode() ? require('./sendNotify') : '';
//debug
$.is_debug = ($.isNode() ? process.env.IS_DEDUG : $.getdata('is_debug')) || 'false';
//抢兑配置
const RETRY = 200;    // 重放次数
const DELAY = 30;      // 每次间隔ms
//------------------------------------------
//抢兑状态
var sigma = {
  successCount: 0,
  failCount: 0,
  startTime: 0,
  done: false
};

// ===== 主程序执行入口 =====
!(async () => {
  if (typeof $request != "undefined") {
    // 拦截 redeem 请求 → 快速重放
    await seckillReplay();
  } else if (typeof $response != "undefined" && $response && $response.body) {
    // 拦截 home 响应 → 通知库存
    await showInventory();
  }
})()
.catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
.finally(() => $.done());

// ===== 拦截 home 响应 → 通知库存 =====
async function showInventory() {
  try {
    const body = $.toObj($response.body) || {};
    if (body && (body.kcalBalance !== undefined || body.balance !== undefined)) {
      const balance = body.kcalBalance || body.balance || "N/A";
      const chance = body.exchangeChance || body.chance || "N/A";
      let stockMsg = "";
      const items = body.products || body.goods || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const name = item.productName || "[" + item.productId + "]";
        const stock = item.stock || item.remain || 0;
        const cost = item.kcalCost || item.cost || "?";
        stockMsg += (stock > 0 ? "✅" : "❌") + " " + name + " 库存:" + stock + " 需要:" + cost + "kcal\n";
      }
      $.msg($.name, "余额:" + balance + " 兑换次数:" + chance, stockMsg);
      $.info("余额:" + balance + " 次数:" + chance);
      $.info(stockMsg);
    }
  } catch(e) {
    $.error("home parse error: " + e);
  }
}

// ===== 拦截 redeem 请求 → 快速重放 =====
async function seckillReplay() {
  const url = $request.url || "";
  const method = $request.method || "";

  if (url.indexOf("/quidd/kcal/act/redeem") === -1 || method !== "POST") {
    return;
  }

  const reqBody = $request.body || "";
  const reqHeaders = $request.headers || {};

  // 提取所有签名头
  const signHeaders = {};
  for (const key in reqHeaders) {
    const lower = key.toLowerCase();
    if (lower.indexOf("x-mini") === 0 || lower === "shield" ||
        lower === "authorization" || lower === "x-xsrf-token" ||
        lower === "xsrftoken" || lower === "content-type" ||
        lower === "user-agent" || lower === "cookie" ||
        lower === "accept" || lower === "accept-language") {
      signHeaders[key] = reqHeaders[key];
    }
  }

  $.info("拦截兑换请求");
  $.info("body: " + reqBody.substring(0, 200));
  $.info("签名头: " + Object.keys(signHeaders).length + "个");
  $.info("开始重放 " + RETRY + " 次...");

  sigma.startTime = Date.now();
  sigma.successCount = 0;
  sigma.failCount = 0;
  sigma.done = false;

  // 使用 Promise 数组并发重放
  const promises = [];
  for (let i = 0; i < RETRY; i++) {
    promises.push(retryOnce(i, url, signHeaders, reqBody));
    // 每 DELAY ms 发一个，用 await 简单控制节奏
    if (DELAY > 0) {
      await $.wait(DELAY);
    }
  }
  await Promise.all(promises);

  // 最终统计
  sigma.done = true;
  const elapsed = Date.now() - sigma.startTime;
  const summary = "成功" + sigma.successCount + " 失败" + sigma.failCount + " 耗时" + elapsed + "ms";
  $.info("完成: " + summary);

  if (sigma.successCount === 0) {
    $.msg($.name, "抢兑失败", "0/" + RETRY + "成功 耗时" + elapsed + "ms");
  } else {
    $.msg($.name, "抢兑完成", summary);
  }
}

// 单次重放
async function retryOnce(idx, url, headers, body) {
  try {
    const res = await Request({
      url: url,
      type: "post",
      dataType: "json",
      headers: headers,
      body: body,
      resultType: "response",
      timeout: 10000
    });

    if (!res) {
      sigma.failCount++;
      if (idx < 3) $.info("#" + idx + " 无响应");
      return;
    }

    const status = res.status || res.statusCode || 0;
    const data = res.body ? ($.toObj(res.body) || {}) : ($.toObj(res) || {});

    // 判断成功
    const code = data.code !== undefined ? data.code : (data.status !== undefined ? data.status : -1);
    const msg = data.message || data.msg || data.error || "";

    if (code === 0 || data.success === true || data.orderId || data.couponCode) {
      sigma.successCount++;
      $.info("#" + idx + " ✅ 成功! status=" + status);

      // 首次成功通知
      if (sigma.successCount === 1) {
        const coupon = data.couponCode || data.coupon_code || (data.data ? data.data.couponCode : "") || "N/A";
        $.msg($.name, "🎉 抢兑成功!", "#" + idx + " status=" + status + " 优惠券:" + coupon);
      }
    } else {
      sigma.failCount++;
      if (idx < 3 || (code !== 2001 && code !== "ALREADY_REDEEMED")) {
        $.info("#" + idx + " code=" + code + " msg=" + msg);
      }
      // 已兑换过
      if (code === 2001 || code === "ALREADY_REDEEMED") {
        if (sigma.successCount === 0 && sigma.failCount === 1) {
          $.msg($.name, "已兑换过", msg);
        }
      }
    }
  } catch(e) {
    sigma.failCount++;
    if (idx < 3) $.info("#" + idx + " 异常: " + (e.message || e));
  }
}

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore
function createProxy(t, n) { return new Proxy(t, { get(t, r) { const c = t[r]; return "function" == typeof c ? async function (...r) { try { return await c.apply(t, r) } catch (r) { n.call(t, r) } } : c } }) }
async function sendMsg(a, e) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, e)) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
function debug(g, e = "debug") { "true" === $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
//From xream's ObjectKeys2LowerCase
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
//From sliverkiss's Request
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR] 缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: s, params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = "string" == typeof s ? s : (s && "form" == n ? $.queryStr(s) : $.toStr(s)), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ..."post" === p && { body: y }, ..."get" === p && a && { params: a }, timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : "response" == u ? t : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR] ${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR] ${t}\n`) } }
//jwt parse tool
function parseJwt(t) { const e = t.split("."); if (3 !== e.length) throw new Error("Invalid JWT token"); const a = JSON.parse(o(e[0])), r = JSON.parse(o(e[1])), n = new Date(1e3 * r.exp), p = new Date(parseInt(r.create_date)); return { header: a, payload: r, expDate: g(n), createDate: g(p) }; function o(t) { let e = t.replace(/-/g, "+").replace(/_/g, "/"), a = e.length % 4; a && (e += "=".repeat(4 - a)); const r = atob(e); return decodeURIComponent(escape(r)) } function g(t) { return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}` } }
//From chavyleung's Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => { if (i) return e(i); e({}) })) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_box_id_" + t); if (i) return s(i); e = e || {}; const o = { url: e.url || `https://raw.githubusercontent.com/chavyleung/scripts/master/${t}/${t}.js`, timeout: e.timeout || 5e3 }; this.get(o, ((t, e, o) => { s(o) })) })) } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.ckName = t, this.timeout = 1e4, this.http = this.http ? this.http : require("http"), this.opts = this.opts ? this.opts : {} } getdata(t) { if (this.env === "Surge") return $persistentStore.read(t); if (this.env === "Stash") return $persistentStore.read(t); if (this.env === "Shadowrocket") return $persistentStore.read(t); if (this.env === "Loon") return $persistentStore.read(t); if (this.env === "Quantumult X") return $prefs.valueForKey(t); if (this.env === "Node.js") { if (this.data) return this.data; if (!this.got) this.initGotEnv(t); return new Promise((e => { this.got(this.opts).get(t).then((t => { e(t.body) })) })) } } setdata(t, e) { if (this.env === "Surge") return $persistentStore.write(t, e); if (this.env === "Stash") return $persistentStore.write(t, e); if (this.env === "Shadowrocket") return $persistentStore.write(t, e); if (this.env === "Loon") return $persistentStore.write(t, e); if (this.env === "Quantumult X") return $prefs.setValueForKey(t, e); if (this.env === "Node.js") { if (this.data) return this.data; if (!this.got) this.initGotEnv(e); return new Promise((i => { this.got(this.opts).post(t).then((t => { i(t.body) })) })) } } get(t, e) { return this.send.call(this.env, t, "GET", e) } post(t, e) { return this.send.call(this.env, t, "POST", e) } send(t, e, i = "GET", o = () => { }) { if ("POST" === e && (t.body || t.bytes) && (t.headers || (t.headers = {}), t.headers["Content-Type"] || (t.headers["Content-Type"] = "application/x-www-form-urlencoded")), "Surge" === this.env || "Stash" === this.env || "Shadowrocket" === this.env) { const e = "string" == typeof t ? { url: t } : t; "string" == typeof e.body && e.headers["Content-Type"] || (e.headers["Content-Type"] = "text/plain;charset=UTF-8"); let s = {}; try { e.headers["Content-Type"] && (s["Content-Type"] = e.headers["Content-Type"]), e.headers["Accept"] && (s["Accept"] = e.headers["Accept"]), e.headers["Accept-Encoding"] && (s["Accept-Encoding"] = e.headers["Accept-Encoding"]) } catch { } o = ("function" == typeof o ? o : () => { }), $httpClient.post(e, ((t, e, i) => { o(t, e, i) })) } else if ("Loon" === this.env) { const e = "string" == typeof t ? { url: t } : t; e.method = "POST", o = ("function" == typeof o ? o : () => { }), $httpClient.post(e, ((t, e, i) => { o(t, e, i) })) } else if ("Quantumult X" === this.env) { const e = "string" == typeof t ? { url: t } : t; e.method = "POST", o = ("function" == typeof o ? o : () => { }), $task.fetch(e, ((t, e, i) => { o(t, e, i) })) } else if ("Node.js" === this.env) { const e = "string" == typeof t ? { url: t } : t; e.method = "POST", e.data = e.body, delete e.body, o = ("function" == typeof o ? o : () => { }), this.http.request(e, ((t, e, i) => { o(t, e, i) })) } } get(t, e) { this.send.call(this.env, t, "GET", e) } post(t, e) { this.send.call(this.env, t, "POST", e) } msg(t = this.name, e = "", i = "", o = {}) { if (this.isMute) return; let s, r, a; const g = i => { const e = ({ "M+": (new Date).getMonth() + 1, "d+": (new Date).getDate(), "H+": (new Date).getHours(), "m+": (new Date).getMinutes(), "s+": (new Date).getSeconds(), "q+": Math.floor(((new Date).getMonth() + 3) / 3), S: (new Date).getMilliseconds() }; /(y+)/.test(i) && (i = i.replace(RegExp.$1, ((new Date).getFullYear() + "").substr(4 - RegExp.$1.length))); for (let s in e) new RegExp("(" + s + ")").test(i) && (i = i.replace(RegExp.$1, 1 === RegExp.$1.length ? e[s] : ("00" + e[s]).substr(String(e[s]).length))); return i }; switch (typeof t) { case "string": break; case "object": t.url && (s = t.url), t.mediaUrl && (r = t.mediaUrl), t.mediaUrl_2 && (a = t.mediaUrl_2), t.subtitle && (t.subtitle = t.subtitle), t.title && (t.title = t.title), e = t.title || "", i = t.subtitle || "", o = t; break } let n; switch (typeof i) { case "string": n = i; break; case "object": n = i?.body || JSON.stringify(i); break } switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), o) { let t, e, s; if (o.startsWith("http")) t = o; else if (o.startsWith("data:")) { const [t] = o.split(";"), [, o] = o.split(","); e = o, s = t.replace("data:", "") } else { e = o, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(o) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, i, r(o)); break; case "Quantumult X": $notify(e, s, i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
