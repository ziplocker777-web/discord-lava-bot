require("dotenv").config();
const express = require("express");
const { recordPurchase, getPurchaseForProduct } = require("./purchaseStore");
const {
    getRolesForPurchase,
    getRolesToRevokeOnCancellation,
    resolveSubscriptionTier,
    tierDownloadsChannelId,
    getAllTierRoleIds,
    SUBSCRIPTION_PRODUCT_ID,
} = require("./roles");
const { deliverPurchase, streamWatermarkedPackage, buildDeliveryMessage } = require("./delivery");
const { registerPresetsApi } = require("./presetsApi");
const { registerActivateApi } = require("./activateApi");
const KNOWN_PRODUCT_IDS = require("./products");

// These products bundle the Muzzle Core Configurator (either as the product itself,
// or as part of a graphics pack) and get an automatic watermarked download — everything
// else keeps working exactly as before (role grant only, manual file sharing).
//
// NOT Flash Collection — that's just 4 extra flash textures dropped into an already
//-installed copy's Assets\Presets\ folder, not the app itself. Delivering the full
// APP_TEMPLATE_DIR package for it would just hand the buyer a duplicate of the base
// app; it stays on the plain Google Drive flow like every other non-app product.
const WATERMARKED_PRODUCT_IDS = new Set([
    KNOWN_PRODUCT_IDS["Muzzle Core FX"],
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
    const status = (event.status || "").toLowerCase();
    if (!type) return false;

    if (FINAL_CANCELLATION_EVENT_TYPES.includes(type)) return true;

    // Loose fallback — только "cancel", "fail" сюда намеренно не входит.
    //
    // Read from status as well as type. Observed 2026-08-25: lava.top sends
    // eventType "payment.failed" and puts the subscription part in status,
    // e.g. "subscription-failed". Looking only at type, a real cancellation
    // arriving that way falls through to "Event ... ignored" and the role is
    // never removed. isPaymentSuccessEvent already reads status; these two
    // did not, which is the whole of the bug.
    const both = type + " " + status;
    return both.includes("subscription") && both.includes("cancel");
}

function isRenewalFailureEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    const status = (event.status || "").toLowerCase();
    if (!type) return false;

    if (RENEWAL_FAILURE_EVENT_TYPES.includes(type)) return true;

    // Same reason as above: "payment.failed" + status "subscription-failed" is
    // how a failed charge on a subscription actually arrives.
    const both = type + " " + status;
    return both.includes("subscription") && both.includes("fail") && !both.includes("cancel");
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

                // All three subscription tiers share one product id, so this is the
                // only thing that tells them apart — and it decides both which role
                // is granted and whether the configurator is delivered at all.
                const tier = resolveSubscriptionTier(event);
                if (tier) console.log(`Subscription tier resolved: ${tier.label} (${tier.key})`);

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
                        discordId,
                        // Kept so /getrole and the admin scripts don't have to work the
                        // tier out again from a price that will have moved by then.
                        tier: tier?.key,
                        amount: event.amount,
                        currency: event.currency,
                    });

                    console.log(`Purchase recorded for ${email} (discordId: ${discordId || "—"}, contractId: ${contractIdToStore})`);
                }

                if (discordId) {
                    try {
                        await grantRole(client, discordId, event);
                    } catch (err) {
                        console.error("Role grant failed inside Discord:", err.message);
                    }
                } else {
                    console.warn("Webhook without discordId in clientUtm.utm_content — role not granted automatically.");
                }

                // For the subscription product the product id alone isn't enough: only
                // the tiers that actually include Muzzle Core FX may be handed the
                // watermarked configurator. Basic is priced on the promise that
                // it doesn't contain it.
                const deliversConfigurator =
                    WATERMARKED_PRODUCT_IDS.has(event.product?.id) &&
                    (event.product?.id !== SUBSCRIPTION_PRODUCT_ID || Boolean(tier?.includesConfigurator));

                if (discordId && email && deliversConfigurator) {
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
                            try {
                                const user = await client.users.fetch(discordId);
                                const greeting = event.product?.id === SUBSCRIPTION_PRODUCT_ID
                                    ? "Thanks for subscribing!"
                                    : "Thanks for your purchase!";
                                await user.send(buildDeliveryMessage({
                                    productId: event.product?.id,
                                    productTitle: event.product?.title,
                                    downloadUrl,
                                    licenseKey,
                                    tierLabel: tier?.label,
                                    downloadsChannelId: tierDownloadsChannelId(tier),
                                    greeting,
                                }));
                                console.log(`Watermarked download delivered to ${discordId} (${event.product?.title})`);
                            } catch (dmErr) {
                                // Token/key already exist even though the DM failed (buyer
                                // has DMs from server members off, most likely) — log them
                                // so an admin can relay manually instead of digging through
                                // watermarkStore.json by hand.
                                console.error(`DM delivery failed for ${discordId} (${event.product?.title}):`, dmErr.message);
                                console.log(`  Download: ${downloadUrl}`);
                                console.log(`  License key: ${licenseKey}`);
                            }
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
                        // Flash Collection is an add-on that needs the base Muzzle Core FX
                        // tool already installed — buyers who skip the panel description
                        // regularly buy this alone thinking it's the whole app, then think
                        // they got scammed when it doesn't work. Spell it out here too.
                        const flashCollectionNote = event.product?.id === KNOWN_PRODUCT_IDS["Muzzle Core FX | Flash Collection"]
                            ? `\n\n⚠️ This is an add-on for the Muzzle Core FX configurator — it does NOT include the app itself. If you don't already own Muzzle Core FX, you'll need it too (see #ticket if unsure).`
                            : "";
                        // A tier that doesn't include the configurator also lands here, and for
                        // it the raw product title ("Subscription ziplocker") says nothing, nor is
                        // there a lava.top download to point at: everything that tier covers is
                        // posted in the subscriber channel.
                        const tierChannelId = tierDownloadsChannelId(tier);
                        const subscriberChannelNote = tierChannelId
                            ? `<#${tierChannelId}>`
                            : "your subscriber channel";

                        const confirmation = tier
                            ? `Thanks for subscribing!\n\nYour **${tier.label}** subscription is active and your role has been applied.\n\n` +
                              `Everything it includes is posted in ${subscriberChannelNote} — head there for the downloads.`
                            : `Thanks for your purchase!\n\n**${event.product?.title || "Your order"}**\n\n` +
                              `The download link was sent to your email and is available in your lava.top account:\n` +
                              `https://app.lava.top/my-purchases${flashCollectionNote}`;

                        await user.send(confirmation);
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
                    // Specifically this product's purchase — the email may own others
                    // too, and we want the discordId tied to the thing being cancelled.
                    const purchase = getPurchaseForProduct(email, event.product?.id);
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
                        await revokeRole(client, discordId, event);
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

async function grantRole(client, discordId, purchase) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    // force: true — discord.js по умолчанию отдаёт участника из кэша, если он
    // там уже есть, и НЕ делает свежий запрос к API. Если роли менялись не
    // через этого бота (вручную в Discord, или другим процессом), кэш может
    // быть устаревшим — тогда member.roles.cache ниже врёт.
    const member = await guild.members.fetch({ user: discordId, force: true });

    const roleIds = getRolesForPurchase(purchase);

    if (roleIds.length === 0) {
        console.warn(`No roles configured for product ${purchase?.productId} — nothing granted.`);
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

    // The tiers are a ladder, not a collection: someone moving from Basic to
    // Premium must stop being Basic, or the cheapest role they ever held would
    // keep letting them into everything it unlocks. Only runs when a tier role was
    // actually granted above — an ordinary one-off purchase must not touch the
    // subscription roles of a member who also happens to be subscribed.
    const grantedTierRoles = getAllTierRoleIds().filter((id) => roleIds.includes(id));
    if (grantedTierRoles.length === 0) return;

    for (const staleRoleId of getAllTierRoleIds()) {
        if (grantedTierRoles.includes(staleRoleId)) continue;
        if (!member.roles.cache.has(staleRoleId)) continue;
        await member.roles.remove(staleRoleId);
        console.log(`Superseded tier role ${staleRoleId} removed from ${discordId}`);
    }
}

async function revokeRole(client, discordId, purchase) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch({ user: discordId, force: true });

    const roleIds = getRolesToRevokeOnCancellation(purchase);

    if (roleIds.length === 0) {
        console.warn("No tier role ids configured (BASIC_ROLE_ID / SUBSCRIBE_ROLE_ID / PREMIUM_ROLE_ID) — nothing to revoke.");
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