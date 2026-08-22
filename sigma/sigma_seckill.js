/*
------------------------------------------
@Date: 2026.08.22
@Description: Sigma 卡路里抢兑 — cron定时重放
------------------------------------------
new Env("Sigma卡路里抢兑");
cron 0 58 17 * * * sigma_seckill.js
脚本兼容：Surge、QuantumultX、Loon、Shadowrocket，不支持青龙
活动: 燃烧我的卡路里 (activityId:1001)
每天18:00放库存, 每日限兑1次, 活动截止2026-08-31
前置: 需先用sigma_rewrite.js重写脚本获取凭证(sigma_data)

⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
*/
const $ = new Env("Sigma卡路里抢兑");
//notify
const notify = $.isNode() ? require('./sendNotify') : '';
//debug
$.is_debug = ($.isNode() ? process.env.IS_DEDUG : $.getdata('is_debug')) || 'false';
//ckName
const ckName = "sigma_data";
//抢兑配置
const RETRY = 200;    // 重放次数
const DELAY = 30;      // 每次间隔ms
// 抢购商品配置 (从HAR抓包获取的商品列表)
// 2002=霸王茶姬1200  2005=CoCo1100  2001=柠季1100  2004=超级碗2100  2003=必胜客4800
const TARGET_PRODUCT_ID = 2002;  // 目标商品ID, 改这里换商品
const ACTIVITY_ID = 1001;
//------------------------------------------
$.notifyMsg = [];
$.succCount = 0;
var sigma = {
  successCount: 0,
  failCount: 0,
  startTime: 0,
  done: false
};

// ===== 主程序执行入口 =====
!(async () => {
  // cron模式: 读取重写存储的凭证, 定时重放
  await checkEnv();
  await main();
})()
.catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
.finally(async () => { $.done({}); });

// ===== 检查凭证 =====
async function checkEnv() {
  const ck = $.getjson(ckName, null);
  if (!ck || !ck.url || !ck.headers) {
    throw new Error(`无凭证! 请先在QX中用sigma_rewrite.js重写脚本获取凭证`);
  }
  const ageMs = Date.now() - (ck.saveTs || 0);
  const ageMin = Math.floor(ageMs / 60000);
  $.info(`凭证年龄: ${ageMin}分钟`);
  if (ageMin > 120) {
    $.warn(`凭证已超${ageMin}分钟, 签名可能已过期`);
  }
  sigma.ck = ck;
  return true;
}

// ===== 主函数 =====
async function main() {
  const ck = sigma.ck;

  // 构造兑换body: 用目标商品ID
  const redeemBody = JSON.stringify({
    activityId: ACTIVITY_ID,
    productId: TARGET_PRODUCT_ID
  });

  $.info(`目标商品: ${TARGET_PRODUCT_ID}`);
  $.info(`兑换URL: ${ck.url}`);
  $.info(`凭证保存时间: ${ck.saveTime || 'unknown'}`);

  // 等到18:00:00.500
  await waitTarget(18, 0, 0, 500);

  $.info(`开始重放 ${RETRY} 次, 间隔${DELAY}ms...`);
  sigma.startTime = Date.now();
  sigma.successCount = 0;
  sigma.failCount = 0;
  sigma.done = false;

  // 串行重试, 成功/终止即停
  for (let i = 0; i < RETRY; i++) {
    if (sigma.done) {
      $.info(`第${i}次起跳过, 已完成`);
      break;
    }
    await retryOnce(i, ck.url, ck.headers, redeemBody);
    if (i < RETRY - 1 && !sigma.done) {
      await $.wait(DELAY);
    }
  }

  // 最终统计
  const elapsed = Date.now() - sigma.startTime;
  const summary = `成功${sigma.successCount} 失败${sigma.failCount} 耗时${elapsed}ms`;
  $.info("完成: " + summary);
  $.notifyMsg.push(`[重放统计] ${summary}`);
  await sendMsg($.notifyMsg.join("\n"));
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
      if (idx < 3) $.info(`#${idx} 无响应`);
      return;
    }

    const status = res.status || res.statusCode || 0;
    const data = res.body ? ($.toObj(res.body) || {}) : ($.toObj(res) || {});

    // 判断成功: 真实API code=0 且 success=true
    const code = data.code !== undefined ? data.code : -1;
    const msg = data.msg || data.message || data.error || "";

    if (code === 0 && data.success === true) {
      sigma.successCount++;
      sigma.done = true;
      const item = data.data || {};
      $.info(`#${idx} ✅ 抢兑成功! status=${status}`);
      $.notifyMsg.push(`🎉 抢兑成功! 第${idx + 1}次尝试\n${$.toStr(item).substring(0, 300)}`);
      return;
    }

    // 终止条件: 每日上限/已兑换/库存没了 → 停止
    if (/上限|已兑换|已参与|次数|不足|抢光|结束/.test(msg)) {
      sigma.failCount++;
      sigma.done = true;
      $.info(`#${idx} 终止: ${msg}`);
      $.notifyMsg.push(`⛔️ ${msg}`);
      return;
    }

    // 签名过期 (401/403)
    if (status === 401 || status === 403) {
      sigma.failCount++;
      sigma.done = true;
      $.info(`#${idx} 签名过期 status=${status}`);
      $.notifyMsg.push(`⛔️ 签名过期, 请重新获取凭证`);
      return;
    }

    sigma.failCount++;
    if (idx < 5 || idx % 50 === 0) {
      $.info(`#${idx} code=${code} msg=${msg} status=${status}`);
    }
  } catch(e) {
    sigma.failCount++;
    if (idx < 3) $.info(`#${idx} 异常: ${e.message || e}`);
  }
}

// ===== 等到目标时间 =====
async function waitTarget(hour, minute = 0, second = 0, millisecond = 0) {
  const now = new Date();
  const targetTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    second,
    millisecond
  );

  if (now < targetTime) {
    const waitMs = targetTime - now;
    $.info(`等待到 ${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${millisecond}, 预计等待 ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } else {
    $.info(`已过目标时间, 立即执行`);
  }
}

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore
async function sendMsg(a, e) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, e)) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
async function checkEnv() { }
function debug(g, e = "debug") { "true" === $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
//From xream's ObjectKeys2LowerCase
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
//From sliverkiss's Request
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR] 缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: s, params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = "string" == typeof s ? s : (s && "form" == n ? $.queryStr(s) : $.toStr(s)), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ..."post" === p && { body: y }, ..."get" === p && a && { params: a }, timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : "response" == u ? t : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR] ${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR] ${t}\n`) } }
//From chavyleung's Env.js
