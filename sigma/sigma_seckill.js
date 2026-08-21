/* Sigma 2.17 卡路里抢兑 — QX版
 * 原理：APP点兑换时QX拦截已签名请求，脚本快速重放N次
 * edith签名绑定body+requestId，同请求重放服务端处理首个+拒绝重复
 *
 * 用法：
 * 1. QX重写订阅添加本conf
 * 2. 打开Sigma APP进入卡路里活动页
 * 3. 点击兑换按钮
 * 4. QX自动拦截并重放200次
 * 5. 结果在QX通知栏/日志查看
 *
 * 命令（QX脚本编辑器输入）：
 * - $sigma.status()    查看上次抢兑结果
 * - $sigma.setRetry(300)  设置重试次数
 */

const SIGMA = {
    retry: 200,
    delay: 30,  // ms between retries
    lastResult: null,
    successCount: 0,
    failCount: 0,
    startTime: 0,

    setRetry(n) { this.retry = n; console.log(`[Sigma] retry set to ${n}`); },
    status() {
        if (!this.lastResult) { console.log("[Sigma] 无抢兑记录"); return; }
        console.log(`[Sigma] 成功:${this.successCount} 失败:${this.failCount} 耗时:${Date.now()-this.startTime}ms`);
        console.log(`[Sigma] 最后结果: ${JSON.stringify(this.lastResult)}`);
    }
};

// ============ 拦截 home API → 显示库存通知 ============
if ($response && $response.body) {
    try {
        const body = JSON.parse($response.body);
        if (body && (body.kcalBalance !== undefined || body.balance !== undefined)) {
            const balance = body.kcalBalance || body.balance || "N/A";
            const chance = body.exchangeChance || body.chance || "N/A";
            let stockMsg = "";
            if (body.products || body.goods) {
                const items = body.products || body.goods;
                items.forEach(item => {
                    const name = item.productName || `[${item.productId}]`;
                    const stock = item.stock || item.remain || 0;
                    stockMsg += `${stock > 0 ? "✅" : "❌"} ${name} 库存:${stock}\n`;
                });
            }
            $notification.post("Sigma卡路里", `余额:${balance} 兑换次数:${chance}`, stockMsg);
        }
    } catch(e) {}
}

// ============ 拦截 redeem 请求 → 快速重放 ============
if (typeof $request !== "undefined" && $request) {
    const url = $request.url || "";
    const method = $request.method || "";

    // 匹配兑换接口
    if (url.indexOf("/quidd/kcal/act/redeem") !== -1 && method === "POST") {
        const reqBody = $request.body || "";
        const reqHeaders = $request.headers || {};

        // 提取完整签名头
        const signHeaders = {};
        const signKeys = [
            "x-mini-sig", "x-mini-nsig", "x-mini-s1", "x-mini-mua",
            "shield", "authorization", "Authorization",
            "X-XSRF-TOKEN", "XSRF-TOKEN",
            "Content-Type", "content-type",
            "User-Agent", "user-agent"
        ];

        for (const key in reqHeaders) {
            const lower = key.toLowerCase();
            if (lower.startsWith("x-mini") || lower === "shield" ||
                lower === "authorization" || lower === "x-xsrf-token" ||
                lower === "xsrftoken" || lower === "content-type" ||
                lower === "user-agent" || lower === "cookie") {
                signHeaders[key] = reqHeaders[key];
            }
        }

        console.log(`[Sigma] 拦截兑换请求`);
        console.log(`[Sigma] body: ${reqBody.substring(0, 200)}`);
        console.log(`[Sigma] 签名头数量: ${Object.keys(signHeaders).length}`);
        console.log(`[Sigma] 开始重放 ${SIGMA.retry} 次...`);

        SIGMA.startTime = Date.now();
        SIGMA.successCount = 0;
        SIGMA.failCount = 0;

        const fullUrl = url;

        // 快速重放
        for (let i = 0; i < SIGMA.retry; i++) {
            setTimeout(function() {
                $httpClient.post({
                    url: fullUrl,
                    headers: signHeaders,
                    body: reqBody
                }, function(error, response, data) {
                    if (error) {
                        SIGMA.failCount++;
                        if (i < 3) console.log(`[Sigma] #${i} 网络错误: ${error}`);
                    } else {
                        const status = response ? response.status : 0;
                        try {
                            const json = JSON.parse(data);
                            if (json.code === 0 || json.success === true || json.orderId || json.couponCode) {
                                SIGMA.successCount++;
                                SIGMA.lastResult = json;
                                console.log(`[Sigma] #${i} ✅ 成功! status=${status}`);
                                if (SIGMA.successCount === 1) {
                                    const coupon = json.couponCode || json.coupon_code || json.data?.couponCode || "N/A";
                                    $notification.post("Sigma抢兑成功!", `#${i} status=${status}`, `优惠券:${coupon}\n${JSON.stringify(json).substring(0, 300)}`);
                                }
                            } else {
                                SIGMA.failCount++;
                                const code = json.code || json.status || "N/A";
                                const msg = json.message || json.msg || json.error || "";
                                if (i < 3 || code !== "ALREADY_REDEEMED") {
                                    console.log(`[Sigma] #${i} code=${code} msg=${msg}`);
                                }
                                if (code === "ALREADY_REDEEMED" || code === 2001) {
                                    if (SIGMA.successCount === 0 && SIGMA.failCount === 1) {
                                        $notification.post("Sigma抢兑", "已兑换过", msg);
                                    }
                                }
                            }
                        } catch(e) {
                            SIGMA.failCount++;
                            if (i < 3) console.log(`[Sigma] #${i} parse error: ${data.substring(0, 200)}`);
                        }
                    }

                    // 最终统计
                    if (i === SIGMA.retry - 1) {
                        const elapsed = Date.now() - SIGMA.startTime;
                        console.log(`[Sigma] 完成: 成功${SIGMA.successCount} 失败${SIGMA.failCount} 耗时${elapsed}ms`);
                        if (SIGMA.successCount === 0) {
                            $notification.post("Sigma抢兑失败", `0/${SIGMA.retry}成功`, `耗时${elapsed}ms`);
                        }
                    }
                });
            }, i * SIGMA.delay);
        }

        // 放行原始请求
        $done({});
    } else {
        $done({});
    }
} else {
    $done({});
}
