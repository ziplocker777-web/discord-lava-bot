require("dotenv").config();
const express = require("express");
const { recordPurchase, getPurchase } = require("./purchaseStore");
const { getRolesForProduct, getRolesToRevokeOnCancellation, SUBSCRIPTION_PRODUCT_ID } = require("./roles");
const { deliverPurchase, streamWatermarkedPackage } = require("./delivery");
const { registerPresetsApi } = require("./presetsApi");
const { registerActivateApi } = require("./activateApi");
const KNOWN_PRODUCT_IDS = require("./products");

// These products bundle the Muzzle Core Configurator (either as the product itself,
// or as part of a graphics pack) and get an automatic watermarked download — everything
// else keeps working exactly as before (role grant only, manual file sharing).
const WATERMARKED_PRODUCT_IDS = new Set([
    KNOWN_PRODUCT_IDS["Muzzle Core FX"],
    KNOWN_PRODUCT_IDS["Muzzle Core FX | Flash Collection"],
    KNOWN_PRODUCT_IDS["Ziplocker's Graphics Pack V1"],
    KNOWN_PRODUCT_IDS["Ziplocker's Graphics Pack V2"],
    SUBSCRIPTION_PRODUCT_ID,
]);

// Список типов событий, которые означают успешную оплату/оформление
const SUCCESS_EVENT_TYPES = [
    "payment.success",
    "invoice.paid",
    "purchase.success",
    "subscription.created",
    "subscription.active",
    "subscription.renewed"
];

// Реальная, финальная отмена подписки — тут роль действительно снимаем.
const FINAL_CANCELLATION_EVENT_TYPES = [
    "subscription.cancelled",
    "subscription.canceled",
    "subscription.recurring.cancelled",
    "subscription.recurring.canceled",
];

// Неудачная попытка списания — НЕ обязательно финал. По FAQ lava.top, при
// неудачном списании будет ещё 2 попытки (+8ч, +24ч), и только если
// последняя тоже провалится — подписка отменяется сама (тогда прилетит уже
// событие из FINAL_CANCELLATION_EVENT_TYPES выше). Поэтому тут только лог
// для видимости, роль НЕ трогаем — иначе снимем её уже на первой попытке,
// хотя у человека может пройти вторая/третья.
const RENEWAL_FAILURE_EVENT_TYPES = [
    "subscription.failed",
    "subscription.recurring.payment.failed",
    "subscription.recurring.failed",
];

function isPaymentSuccessEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    const status = (event.status || "").toLowerCase();

    if (!type) return false;

    // Прямое совпадение по типу события
    if (SUCCESS_EVENT_TYPES.includes(type)) return true;

    // Резервная проверка: если в событии есть payment/invoice/purchase/subscription И статус указывает на успешную оплату
    const isPaymentType = type.includes("payment") || type.includes("invoice") || type.includes("purchase") || type.includes("subscription");
    const isSuccessStatus = status === "completed" || status === "success" || status === "paid" || status === "active";

    return isPaymentType && isSuccessStatus;
}

function isFinalCancellationEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    if (!type) return false;

    if (FINAL_CANCELLATION_EVENT_TYPES.includes(type)) return true;

    // Loose fallback — только "cancel", "fail" сюда намеренно не входит.
    return type.includes("subscription") && type.includes("cancel");
}

function isRenewalFailureEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    if (!type) return false;

    if (RENEWAL_FAILURE_EVENT_TYPES.includes(type)) return true;

    return type.includes("subscription") && type.includes("fail") && !type.includes("cancel");
}

function checkApiKey(req, res, next) {
    const key = req.header("X-Api-Key");
    const stamp = new Date().toISOString();

    if (!key) {
        console.warn(`[webhook] REJECTED 401 (missing key) — ip: ${req.ip}, time: ${stamp}`);
        return res.status(401).send("Missing API Key");
    }

    if (key !== process.env.WEBHOOK_API_KEY) {
        console.warn(`[webhook] REJECTED 401 (invalid key, got "${key.slice(0, 4)}...", len ${key.length}) — ip: ${req.ip}, time: ${stamp}`);
        return res.status(401).send("Invalid API Key");
    }

    next();
}

function startWebhookServer(client) {
    const app = express();
    app.use(express.json());

    // express.json() кидает ошибку синхронно ДО того, как запрос доходит до
    // роута/логгера ниже — без этого обработчика битый JSON от клиента
    // (в т.ч. потенциально от lava.top) проходил бы вообще без единой
    // строки в логах, просто молча получая 400.
    app.use((err, req, res, next) => {
        if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
            console.error(
                `[webhook] JSON PARSE FAILED — ip: ${req.ip}, time: ${new Date().toISOString()}, ` +
                `content-length: ${req.headers["content-length"] || "?"}, error: ${err.message}`
            );
            return res.status(400).send("Invalid JSON");
        }
        next(err);
    });

    registerPresetsApi(app);
    registerActivateApi(app);

    app.post("/webhook/lava", (req, res, next) => {
        console.log(`[webhook] incoming — ip: ${req.ip}, hasApiKey: ${Boolean(req.header("X-Api-Key"))}, time: ${new Date().toISOString()}`);
        next();
    }, checkApiKey, async (req, res) => {
        console.log("========== WEBHOOK ==========");
        console.log("Body:", JSON.stringify(req.body, null, 2));

        const event = req.body;

        try {
            if (isPaymentSuccessEvent(event)) {
                console.log(`Payment success event received: ${event.eventType}`);

                const email = event.buyer?.email;
                const discordId = event.clientUtm?.utm_content || null;

                if (email) {
                    // На событии subscription.recurring.payment.success у lava.top
                    // есть ДВА разных id: event.contractId — это контракт именно
                    // ЭТОГО списания (новый на каждый месяц), а event.parentContractId
                    // — оригинальный контракт подписки, который и нужен для
                    // cancelSubscription(). На первом payment.success (initial)
                    // parentContractId не существует — там event.contractId и есть
                    // тот самый "родительский" id, который дальше не должен меняться.
                    const contractIdToStore = event.parentContractId || event.contractId;

                    recordPurchase(email, {
                        productId: event.product?.id,
                        productTitle: event.product?.title,
                        contractId: contractIdToStore,
                        timestamp: event.timestamp,
                        discordId
                    });

                    console.log(`Purchase recorded for ${email} (discordId: ${discordId || "—"}, contractId: ${contractIdToStore})`);
                }

                if (discordId) {
                    try {
                        await grantRole(client, discordId, event.product?.id);
                    } catch (err) {
                        console.error("Role grant failed inside Discord:", err.message);
                    }
                } else {
                    console.warn("Webhook without discordId in clientUtm.utm_content — role not granted automatically.");
                }

                if (discordId && email && WATERMARKED_PRODUCT_IDS.has(event.product?.id)) {
                    try {
                        const { downloadUrl, licenseKey, isNew } = deliverPurchase({
                            email,
                            discordId,
                            productId: event.product?.id,
                            productTitle: event.product?.title,
                        });

                        // Only DM on the actual first delivery — a subscription fires this
                        // same code path every renewal, and isNew is false from then on
                        // since the token/key are reused. Re-sending the DM on every
                        // renewal would be spam; buyers who want another copy can always
                        // pull one themselves via /getrole or /panelredownload.
                        if (isNew) {
                            const user = await client.users.fetch(discordId);
                            const isSubscription = event.product?.id === SUBSCRIPTION_PRODUCT_ID;

                            // The subscription's product title ("Subscription ziplocker") isn't
                            // what's actually being downloaded here, so it gets its own intro
                            // explaining that the app comes bundled with the membership —
                            // everything else shows the real product title as-is.
                            const intro = isSubscription
                                ? `Thanks for subscribing!\n\nYour membership includes the **Muzzle Core Configurator** — the tool for customizing muzzle flash, sparks, smoke, tracers and bullet impacts. Here's your download and license key:\n${downloadUrl}`
                                : `Thanks for your purchase!\n\n**${event.product?.title || "Your download"}**\n${downloadUrl}`;

                            // Subscribers also get pointed at the channel their role unlocks —
                            // the configurator is only one of several perks in there.
                            const channelNote = isSubscription
                                ? (process.env.SUBSCRIBER_CHANNEL_ID
                                    ? `\n\nAlso check out <#${process.env.SUBSCRIBER_CHANNEL_ID}> — that's where the rest of the subscriber-only mods are posted.`
                                    : "\n\nAlso check out your new subscriber channel — that's where the rest of the subscriber-only mods are posted.")
                                : "";
                            // Deliberately plain about the download — no mention of watermarking.
                            // The license key IS meant to be visible; it's what unlocks the app.
                            await user.send(
                                `${intro}\n\n` +
                                `Your license key (enter this in the app to unlock it):\n\`${licenseKey}\`\n\n` +
                                `This link and key are tied to your order — please don't share them.${channelNote}`
                            );
                            console.log(`Watermarked download delivered to ${discordId} (${event.product?.title})`);
                        } else {
                            console.log(`Watermark already existed for ${discordId} (${event.product?.title}) — DM skipped.`);
                        }
                    } catch (err) {
                        console.error("Watermarked delivery failed:", err.message);
                    }
                } else if (discordId) {
                    // Every other product (not watermarked, not the subscription — that
                    // one's handled above now) has no bot-side delivery — lava.top emails
                    // the buyer their Google Drive link directly — but staying silent here
                    // felt broken from the buyer's side, so we still confirm the purchase.
                    try {
                        const user = await client.users.fetch(discordId);
                        await user.send(
                            `Thanks for your purchase!\n\n**${event.product?.title || "Your order"}**\n\n` +
                            `The download link was sent to your email and is available in your lava.top account:\n` +
                            `https://app.lava.top/my-purchases`
                        );
                        console.log(`Purchase confirmation DM sent to ${discordId} (${event.product?.title})`);
                    } catch (err) {
                        console.error("Purchase confirmation DM failed:", err.message);
                    }
                }

                return res.sendStatus(200);
            } else if (isRenewalFailureEvent(event)) {
                // Не финал — просто попытка списания не прошла, у lava.top
                // в запасе ещё 1-2 попытки (+8ч, +24ч). Роль НЕ трогаем,
                // только фиксируем в логах на случай, если понадобится
                // отследить паттерн (например, если один и тот же человек
                // проваливает попытку за попыткой).
                console.warn(
                    `Renewal payment attempt failed (not cancelling yet): ${event.eventType}, ` +
                    `buyer: ${event.buyer?.email || "?"}, errorMessage: ${event.errorMessage || "?"}`
                );
                return res.sendStatus(200);
            } else if (isFinalCancellationEvent(event)) {
                console.log(`Subscription cancellation-like event received: ${event.eventType}`);

                const email = event.buyer?.email;

                let discordId = event.clientUtm?.utm_content || null;
                if (!discordId && email) {
                    const purchase = getPurchase(email);
                    discordId = purchase?.discordId || null;
                }

                if (email) {
                    recordPurchase(email, {
                        productId: event.product?.id,
                        productTitle: event.product?.title,
                        contractId: event.contractId,
                        timestamp: event.timestamp,
                        discordId,
                        status: "cancelled",
                    });
                }

                if (discordId) {
                    try {
                        await revokeRole(client, discordId);
                    } catch (err) {
                        console.error("Role revoke failed inside Discord:", err.message);
                    }
                } else {
                    console.warn("Cancellation webhook without a resolvable discordId — Membership role not revoked automatically.");
                }

                return res.sendStatus(200);
            } else {
                console.log(`Event ${event.eventType} ignored.`);
                return res.sendStatus(200);
            }
        } catch (error) {
            console.error("Critical error inside webhook processing:", error);
            return res.status(200).send("Webhook received with internal tracking error");
        }
    });

    // Per-buyer download link sent in the DM above. Not authenticated beyond the
    // token itself being unguessable (32 hex chars) — same trust model as any
    // "here's your unlisted download link" delivery.
    app.get("/download/:token", (req, res) => {
        const ok = streamWatermarkedPackage(res, req.params.token);
        if (!ok) {
            console.warn(`[download] unknown token requested — ip: ${req.ip}`);
            res.status(404).send("Not found");
        }
    });

    const port = process.env.PORT || 3000;

    app.listen(port, () => {
        console.log(`Webhook server listening on port ${port}`);
    });
}

async function grantRole(client, discordId, productId) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    // force: true — discord.js по умолчанию отдаёт участника из кэша, если он
    // там уже есть, и НЕ делает свежий запрос к API. Если роли менялись не
    // через этого бота (вручную в Discord, или другим процессом), кэш может
    // быть устаревшим — тогда member.roles.cache ниже врёт.
    const member = await guild.members.fetch({ user: discordId, force: true });

    const roleIds = getRolesForProduct(productId);

    if (roleIds.length === 0) {
        console.warn(`No roles configured for product ${productId} — nothing granted.`);
        return;
    }

    for (const roleId of roleIds) {
        if (member.roles.cache.has(roleId)) {
            console.log(`${discordId} already has role ${roleId}.`);
            continue;
        }
        await member.roles.add(roleId);
        console.log(`Role ${roleId} granted to ${discordId}`);
    }
}

async function revokeRole(client, discordId) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch({ user: discordId, force: true });

    const roleIds = getRolesToRevokeOnCancellation();

    if (roleIds.length === 0) {
        console.warn("SUBSCRIBE_ROLE_ID is not configured — nothing to revoke.");
        return;
    }

    for (const roleId of roleIds) {
        if (!member.roles.cache.has(roleId)) {
            console.log(`${discordId} doesn't have role ${roleId}, nothing to remove.`);
            continue;
        }
        await member.roles.remove(roleId);
        console.log(`Role ${roleId} revoked from ${discordId}`);
    }
}

module.exports = { startWebhookServer, revokeRole, WATERMARKED_PRODUCT_IDS };