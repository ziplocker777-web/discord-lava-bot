require("./env.js").loadEnv();

/**
 * Route sample events through the real predicates and show what each one does.
 *
 * The predicates are pulled out of the shipped webhookServer.js rather than
 * retyped, because a copy would only prove that the copy works. Nothing is sent
 * and nothing is granted: this reads source and evaluates it.
 *
 * The order matters as much as the matching, and it is the handler's own: a
 * refund arriving as "payment.refunded / completed" has to be caught as a refund
 * before anything reads it as a sale.
 */

const src = require("fs").readFileSync(require("path").join(__dirname, "webhookServer.js"), "utf-8");

const names = [
    "SUCCESS_EVENT_TYPES",
    "FINAL_CANCELLATION_EVENT_TYPES",
    "RENEWAL_FAILURE_EVENT_TYPES",
    "isRefundEvent",
    "isChargebackEvent",
    "isPaymentSuccessEvent",
    "isFinalCancellationEvent",
    "isRenewalFailureEvent",
];

for (const n of names) {
    const asConst = new RegExp(`const ${n}\\s*=\\s*\\[[\\s\\S]*?\\];`);
    const asFunc = new RegExp(`function ${n}\\([\\s\\S]*?\\n\\}`);
    const m = src.match(asConst) || src.match(asFunc);
    if (!m) throw new Error("не найдено в webhookServer.js: " + n);
    eval(m[0].replace(/^const /, "globalThis.").replace(/^function /, "globalThis." + n + " = function "));
}

function route(e) {
    if (isRefundEvent(e)) return "ВОЗВРАТ — заблокировать и вычесть из выручки";
    if (isChargebackEvent(e)) return "ЧАРДЖБЭК — вычесть из выручки, доступ не трогать";
    if (isPaymentSuccessEvent(e)) return "ОПЛАТА — выдать роль и ключ";
    if (isRenewalFailureEvent(e)) return "провал платежа — роль на месте, ждём повтора";
    if (isFinalCancellationEvent(e)) return "ОТМЕНА — записать, роль снимет ночной крон";
    return "проигнорировано";
}

const cases = [
    ["обычная покупка", { eventType: "payment.success", status: "completed" }, "ОПЛАТА"],
    ["продление (настоящее)", { eventType: "subscription.recurring.payment.success", status: "subscription-active" }, "ОПЛАТА"],
    ["первая подписка", { eventType: "subscription.created", status: "completed" }, "ОПЛАТА"],
    // Разовая покупка, которая не прошла: снимать нечего, выдавать нечего.
    ["отказ карты на разовой покупке", { eventType: "payment.failed", status: "failed" }, "проигнорировано"],
    ["провал продления", { eventType: "subscription.recurring.payment.failed", status: "subscription-failed" }, "провал платежа"],
    ["отмена подписки", { eventType: "subscription.cancelled", status: "cancelled" }, "ОТМЕНА"],
    // Истечение приходит без даты окончания оплаченного периода, поэтому его и
    // не ловят: revoke-lapsed читает API, где эта дата есть, и снимает роль ночью.
    ["подписка истекла", { eventType: "subscription.expired", status: "subscription-expired" }, "проигнорировано"],
    ["возврат", { eventType: "refund.success", status: "refunded" }, "ВОЗВРАТ"],
    ["чарджбэк", { eventType: "chargeback.created", status: "chargeback" }, "ЧАРДЖБЭК"],
    ["ловушка: возврат под видом оплаты", { eventType: "payment.refunded", status: "completed" }, "ВОЗВРАТ"],
    ["ловушка: refunded в статусе", { eventType: "payment.success", status: "payment-refunded" }, "не ОПЛАТА"],
    ["ловушка: failed со словом payment", { eventType: "subscription.payment.failed", status: "subscription-payment-failed" }, "не ОПЛАТА"],
    ["мусор", { eventType: "product.updated", status: "whatever" }, "проигнорировано"],
];

let bad = 0;
console.log("событие".padEnd(36) + "что сделает бот");
console.log("-".repeat(84));

for (const [label, event, expect] of cases) {
    const got = route(event);
    const ok = expect.startsWith("не ")
        ? !got.startsWith(expect.slice(3))
        : got.startsWith(expect);
    if (!ok) bad += 1;
    console.log(`${ok ? "  " : "!!"} ${label.padEnd(34)}${got}`);
}

console.log("-".repeat(84));
console.log(bad ? `РАСХОЖДЕНИЙ: ${bad}` : "все события маршрутизируются как задумано");
process.exit(bad ? 1 : 0);
