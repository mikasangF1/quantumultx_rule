/* ------------------------------------------
 Sigma 2.17 卡路里抢兑
 拦截APP已签名兑换请求，快速重放200次
------------------------------------------
脚本兼容：QuantumultX、Surge、Loon
不支持青龙

[rewrite_local]
^https:\/\/[^\/]+\/quidd\/kcal\/act\/home url script-response-body sigma_seckill.js
^https:\/\/[^\/]+\/quidd\/kcal\/act\/redeem$ url script-request-body sigma_seckill.js

[MITM]
hostname = as.sigma.run, api.sigma.run
*/

const RETRY = 200;    // 重放次数
const DELAY = 30;     // 每次间隔ms

var sigma = {
    successCount: 0,
    failCount: 0,
    startTime: 0,
    done: false
};

// ===== 拦截 home 响应 → 通知库存 =====
if (typeof $response !== "undefined" && $response && $response.body) {
    try {
        var body = JSON.parse($response.body);
        if (body && (body.kcalBalance !== undefined || body.balance !== undefined)) {
            var balance = body.kcalBalance || body.balance || "N/A";
            var chance = body.exchangeChance || body.chance || "N/A";
            var stockMsg = "";
            var items = body.products || body.goods || [];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var name = item.productName || "[" + item.productId + "]";
                var stock = item.stock || item.remain || 0;
                var cost = item.kcalCost || item.cost || "?";
                stockMsg += (stock > 0 ? "✅" : "❌") + " " + name + " 库存:" + stock + " 需要:" + cost + "kcal\n";
            }
            if (typeof $notification !== "undefined") {
                $notification.post("Sigma卡路里", "余额:" + balance + " 兑换次数:" + chance, stockMsg);
            }
            console.log("[Sigma] 余额:" + balance + " 次数:" + chance);
            console.log("[Sigma] " + stockMsg);
        }
    } catch(e) {
        console.log("[Sigma] home parse error: " + e);
    }
    $done({});
}

// ===== 拦截 redeem 请求 → 快速重放 =====
if (typeof $request !== "undefined" && $request) {
    var url = $request.url || "";
    var method = $request.method || "";

    if (url.indexOf("/quidd/kcal/act/redeem") !== -1 && method === "POST") {
        var reqBody = $request.body || "";
        var reqHeaders = $request.headers || {};

        // 提取所有签名头
        var signHeaders = {};
        for (var key in reqHeaders) {
            var lower = key.toLowerCase();
            if (lower.indexOf("x-mini") === 0 || lower === "shield" ||
                lower === "authorization" || lower === "x-xsrf-token" ||
                lower === "xsrftoken" || lower === "content-type" ||
                lower === "user-agent" || lower === "cookie" ||
                lower === "accept" || lower === "accept-language") {
                signHeaders[key] = reqHeaders[key];
            }
        }

        console.log("[Sigma] 拦截兑换请求");
        console.log("[Sigma] body: " + reqBody.substring(0, 200));
        console.log("[Sigma] 签名头: " + Object.keys(signHeaders).length + "个");
        console.log("[Sigma] 开始重放 " + RETRY + " 次...");

        sigma.startTime = Date.now();
        sigma.successCount = 0;
        sigma.failCount = 0;
        sigma.done = false;

        var fullUrl = url;

        for (var i = 0; i < RETRY; i++) {
            (function(idx) {
                setTimeout(function() {
                    $httpClient.post({
                        url: fullUrl,
                        headers: signHeaders,
                        body: reqBody
                    }, function(error, response, data) {
                        if (error) {
                            sigma.failCount++;
                            if (idx < 3) console.log("[Sigma] #" + idx + " 网络错误: " + error);
                        } else {
                            var status = response ? response.status : 0;
                            try {
                                var json = JSON.parse(data);
                                var code = json.code !== undefined ? json.code : (json.status !== undefined ? json.status : -1);
                                var msg = json.message || json.msg || json.error || "";

                                if (code === 0 || json.success === true || json.orderId || json.couponCode) {
                                    sigma.successCount++;
                                    console.log("[Sigma] #" + idx + " ✅ 成功! status=" + status);
                                    if (sigma.successCount === 1) {
                                        var coupon = json.couponCode || json.coupon_code || (json.data ? json.data.couponCode : "") || "N/A";
                                        if (typeof $notification !== "undefined") {
                                            $notification.post("Sigma抢兑成功!", "#" + idx + " status=" + status, "优惠券:" + coupon + "\n" + JSON.stringify(json).substring(0, 300));
                                        }
                                    }
                                } else {
                                    sigma.failCount++;
                                    if (idx < 3 || (code !== 2001 && code !== "ALREADY_REDEEMED")) {
                                        console.log("[Sigma] #" + idx + " code=" + code + " msg=" + msg);
                                    }
                                    if (code === 2001 || code === "ALREADY_REDEEMED") {
                                        if (sigma.successCount === 0 && sigma.failCount === 1) {
                                            if (typeof $notification !== "undefined") {
                                                $notification.post("Sigma抢兑", "已兑换过", msg);
                                            }
                                        }
                                    }
                                }
                            } catch(e) {
                                sigma.failCount++;
                                if (idx < 3) console.log("[Sigma] #" + idx + " parse err: " + (data || "").substring(0, 200));
                            }
                        }

                        // 最终统计
                        if (idx === RETRY - 1) {
                            sigma.done = true;
                            var elapsed = Date.now() - sigma.startTime;
                            console.log("[Sigma] 完成: 成功" + sigma.successCount + " 失败" + sigma.failCount + " 耗时" + elapsed + "ms");
                            if (typeof $notification !== "undefined" && sigma.successCount === 0) {
                                $notification.post("Sigma抢兑失败", "0/" + RETRY + "成功", "耗时" + elapsed + "ms");
                            }
                        }
                    });
                }, idx * DELAY);
            })(i);
        }

        // 放行原始请求
        $done({});
    } else {
        $done({});
    }
} else {
    $done({});
}
