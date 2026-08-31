require("dotenv").config();
const express = require("express");
const { recordPurchase, markStatus, getPurchaseForProduct } = require("./purchaseStore");
const { checkCollector } = require("./collector");
const {
    getRolesForPurchase,
    getRolesForProduct,
    getRolesToRevokeOnCancellation,
    resolveSubscriptionTier,
    tierDownloadsChannelId,
    getAllTierRoleIds,
    SUBSCRIPTION_PRODUCT_ID,
} = require("./roles");
const { deliverPurchase, streamWatermarkedPackage, buildDeliveryMessage } = require("./delivery");
const { clearRevoked, findByOwner, setRevoked } = require("./watermarkStore");
const { addRefund, removeRefund } = require("./refundedEmails");
const { registerPresetsApi } = require("./presetsApi");
const { registerActivateApi } = require("./activateApi");
const { notifyOwner } = require("./ownerNotify");
const KNOWN_PRODUCT_IDS = require("./products");

// Sales are the only notification frequent enough to become wallpaper.
// Set NOTIFY_SALES=false in .env to keep the rest without them.
const NOTIFY_SALES = process.env.NOTIFY_SALES !== "false";

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
    "subscription.renewed",
    // The real renewal, seen 2026-08-31. It had been tested with a hand-made
    // payload carrying status "completed" and arrived carrying
    // "subscription-active", which the exact-match below did not recognise --
    // so the first genuine renewal this shop ever received was ignored.
    "subscription.recurring.payment.success",
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

/**
 * A refund, and a chargeback, which are not the same thing.
 *
 * A refund is issued by the seller: the decision has already been made, so
 * acting on it automatically only carries out what was decided. A chargeback is
 * forced by a bank and can be wrong -- a mistaken dispute would strip a paying
 * customer -- so that one only ever reports.
 *
 * Read from status as well as type, the same way the others learned to: this
 * gateway has already been seen putting the meaning of an event in status while
 * type said something more generic.
 */
function isRefundEvent(event) {
    const both = ((event.eventType || "") + " " + (event.status || "")).toLowerCase();
    if (!event.eventType) return false;
    return both.includes("refund") && !both.includes("chargeback");
}

function isChargebackEvent(event) {
    const both = ((event.eventType || "") + " " + (event.status || "")).toLowerCase();
    if (!event.eventType) return false;
    return both.includes("chargeback") || both.includes("dispute");
}

function isPaymentSuccessEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    const status = (event.status || "").toLowerCase();

    if (!type) return false;

    // Прямое совпадение по типу события
    if (SUCCESS_EVENT_TYPES.includes(type)) return true;

    // Резервная проверка. Матчим по вхождению, а не по точному равенству:
    //
    // lava.top qualifies its statuses with the thing they belong to, so the same
    // outcome arrives as "completed" on one event and "subscription-active" on
    // another. Exact matching caught the first and missed the second, and every
    // status this gateway has ever sent follows that shape -- "subscription-failed"
    // for the failure, "subscription-active" for the success.
    //
    // Failure and cancellation words are excluded explicitly, so a future
    // "subscription-payment-failed" cannot be read as a success on the strength
    // of containing "payment".
    const isPaymentType = type.includes("payment") || type.includes("invoice")
        || type.includes("purchase") || type.includes("subscription");

    const looksBad = status.includes("fail") || status.includes("cancel")
        || status.includes("refund") || status.includes("charge_back")
        || status.includes("chargeback") || status.includes("expired");

    const looksGood = status.includes("completed") || status.includes("success")
        || status.includes("paid") || status.includes("active");

    return isPaymentType && looksGood && !looksBad;
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
        // Something has been posting here hourly for months and being turned
        // away, and nginx shows it arriving with HTTP basic auth as
        // "lava_webhook_ziplocker" while the deliveries that DO work carry no
        // basic auth and an X-Api-Key instead. That is two senders, so the
        // rejected one has to be identified rather than assumed harmless: if it
        // is carrying real events, they have been thrown away all along.
        let seen = "no body";
        try {
            if (req.body && Object.keys(req.body).length) {
                seen = JSON.stringify(req.body).slice(0, 600);
            }
        } catch {
            seen = "unreadable body";
        }
        console.warn(
            `[webhook] REJECTED 401 (missing key) — ip: ${req.ip}, time: ${stamp}, ` +
            `auth: ${req.header("authorization") ? "basic" : "none"}, ` +
            `ua: ${req.header("user-agent") || "-"}, body: ${seen}`
        );
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

    // nginx sits in front, behind Cloudflare, and both pass the caller along in
    // X-Forwarded-For. Without this Express reads the socket instead and every
    // request in the world is logged as 127.0.0.1 -- which is why the hourly
    // keyless hits on this endpoint looked local and could not be told apart
    // from each other, or from a scanner.
    //
    // Diagnostics only: nothing is authorised by address, the API key does that.
    app.set("trust proxy", true);
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
    registerActivateApi(app, client);

    app.post("/webhook/lava", (req, res, next) => {
        console.log(`[webhook] incoming — ip: ${req.ip}, hasApiKey: ${Boolean(req.header("X-Api-Key"))}, time: ${new Date().toISOString()}`);
        next();
    }, checkApiKey, async (req, res) => {
        console.log("========== WEBHOOK ==========");
        console.log("Body:", JSON.stringify(req.body, null, 2));

        const event = req.body;

        try {
            if (isRefundEvent(event)) {
                // Deliberately ahead of the success test. A refund arriving as
                // "payment.refunded" with status "completed" satisfies that test
                // as well, and would grant a role instead of taking one back.
                console.log(`Refund event received: ${event.eventType}`);
                await handleRefund(client, event);
                return res.sendStatus(200);
            } else if (isChargebackEvent(event)) {
                console.log(`Chargeback event received: ${event.eventType} — reporting only.`);
                await handleChargeback(client, event);
                return res.sendStatus(200);
            } else if (isPaymentSuccessEvent(event)) {
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

                    // Money arriving is the one signal that should bring a dead
                    // key back. Somebody who lapsed, had their key revoked and
                    // then resubscribed must not have to open a ticket to use
                    // what they have just paid for again.
                    if (discordId && event.product?.id) {
                        const restored = clearRevoked(discordId, event.product.id);
                        if (restored) console.log(`License key ${restored} restored for ${discordId} after payment.`);
                    }

                    // Same reasoning: somebody refunded once and buying again must
                    // not stay locked out of the thing they have just paid for.
                    if (removeRefund(email)) {
                        console.log(`${email} taken off the refund list after paying again.`);
                    }
                }

                if (NOTIFY_SALES) {
                    const amount = event.amount ?? "";
                    const currency = event.currency || "";

                    // A renewal carries the original contract alongside this
                    // month's one. Worth separating: a new customer and a month
                    // of recurring revenue are different news, and calling both
                    // a sale makes the count of new customers meaningless.
                    const renewal = Boolean(event.parentContractId)
                        || String(event.eventType || "").includes("recurring");

                    await notifyOwner(client,
                        `**${renewal ? "Renewal" : "Sale"}** — ${event.product?.title || "unknown"}` +
                        `${tier ? ` (${tier.label})` : ""}\n` +
                        `• ${email || "no email"}${amount ? ` — ${amount} ${currency}` : ""}` +
                        `${discordId ? `\n• <@${discordId}>` : "\n• no discord id on the order"}`);
                }

                if (discordId) {
                    try {
                        await grantRole(client, discordId, event);
                    } catch (err) {
                        console.error("Role grant failed inside Discord:", err.message);
                        await notifyOwner(client,
                            `**Paid, but the role could not be granted**\n\n` +
                            `• <@${discordId}> — ${event.product?.title || "unknown"}\n` +
                            `• ${email || "no email"}\n` +
                            `• reason: ${err.message}\n\n` +
                            `Grant it by hand — they have paid.`);
                    }
                } else {
                    console.warn("Webhook without discordId in clientUtm.utm_content — role not granted automatically.");
                    await notifyOwner(client,
                        `**Paid without a Discord id**\n\n` +
                        `• ${email || "no email"} — ${event.product?.title || "unknown"}\n\n` +
                        `The order carries no discord tag, so nothing could be granted ` +
                        `automatically. They can claim it with \`/getrole\`.`);
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

                                // The worst failure this bot has: somebody paid and
                                // received nothing, and until now the only trace was a
                                // log line. Sent with the link and key attached so it
                                // can be relayed by hand in one message.
                                await notifyOwner(client,
                                    `**Buyer did not get their download**\n\n` +
                                    `• <@${discordId}> — ${event.product?.title || "unknown"}\n` +
                                    `• ${email || "no email"}\n` +
                                    `• reason: ${dmErr.message}\n\n` +
                                    `Download: ${downloadUrl}\nLicense key: \`${licenseKey}\`\n\n` +
                                    `Their DMs are most likely closed. Send this to them.`);
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

                // Worth knowing before it becomes a lapse: lava.top retries a
                // couple of times, so there is a day or two here in which a word
                // to the customer can save the subscription.
                await notifyOwner(client,
                    `**Renewal payment failed** — nothing taken away yet\n\n` +
                    `• ${event.buyer?.email || "unknown"}\n` +
                    `• reason: ${event.errorMessage || "not given"}\n\n` +
                    `lava.top will retry. If every attempt fails, the role goes ` +
                    `automatically and the key three days later.`);

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
                    // Merged, not replaced: the tier lives on this record and
                    // nothing else can work it out afterwards.
                    markStatus(email, event.product?.id, {
                        productTitle: event.product?.title,
                        discordId,
                        status: "cancelled",
                        cancelledAt: Date.now(),
                    });
                }

                // Nothing is taken away here, on purpose.
                //
                // Cancelling is not the same as running out. lava.top keeps a
                // cancelled subscription ACTIVE until its paid period ends and
                // records that date as expiredAt -- three of them are sitting
                // there right now, cancelled in August and paid through into
                // September. This event carries no such date, so acting on it
                // would take the role on the day somebody pressed cancel and
                // charge them a month for nothing.
                //
                // revoke-lapsed.js reads the API, which does know, and takes the
                // role when the paid period is actually over. The cost is up to a
                // day's delay for a subscription that ended immediately; the
                // alternative costs a month of somebody's money.
                console.log(
                    `Cancellation noted for ${email || "unknown"} — nothing revoked. ` +
                    "revoke-lapsed.js will act once the paid period is over."
                );

                await notifyOwner(client,
                    `**Subscription cancelled**\n\n` +
                    `• ${email || "unknown"}` +
                    `${discordId ? `\n• <@${discordId}>` : ""}\n\n` +
                    `Nothing taken away: they keep access until the period they have ` +
                    `paid for runs out. It is removed automatically on that date.`);

                return res.sendStatus(200);
            } else {
                console.log(`Event ${event.eventType} ignored.`);
                return res.sendStatus(200);
            }
        } catch (error) {
            console.error("Critical error inside webhook processing:", error);

            // 200 is returned below, which means lava.top considers this
            // delivered and will never send it again. If it was a payment, the
            // customer has paid and whatever should have followed did not
            // happen -- and nothing else in the system will ever notice.
            await notifyOwner(client,
                `**Webhook failed while being processed**\n\n` +
                `• event: ${req.body?.eventType || "unknown"}\n` +
                `• ${req.body?.buyer?.email || "no email"} — ${req.body?.product?.title || "unknown"}\n` +
                `• error: ${error.message}\n\n` +
                `lava.top has been told this was delivered and will not resend it. ` +
                `If it was a payment, check that they got their role and download.`);

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
    // The badge for owning more than one product. Checked after the purchase has
    // been recorded, so the count it reads includes the thing just bought.
    await checkCollector(client, discordId, purchase?.buyer?.email || purchase?.email);

    const grantedTierRoles = getAllTierRoleIds().filter((id) => roleIds.includes(id));
    if (grantedTierRoles.length === 0) return;

    for (const staleRoleId of getAllTierRoleIds()) {
        if (grantedTierRoles.includes(staleRoleId)) continue;
        if (!member.roles.cache.has(staleRoleId)) continue;
        await member.roles.remove(staleRoleId);
        console.log(`Superseded tier role ${staleRoleId} removed from ${discordId}`);
    }
}

/**
 * A refund the seller issued: undo the sale.
 *
 * Three things go, and they are separate on purpose. The role closes the
 * channels. The licence key stops the configurator that is already sitting on
 * their disk -- without it a refund meant "money back, keep the software". The
 * email goes on the refund list so /getrole cannot simply re-issue everything a
 * minute later.
 *
 * The refund list is per EMAIL, not per product: someone who refunds one thing
 * and legitimately owns another loses self-serve access to both and has to ask.
 * That was already true when this was a manual script and is not made worse by
 * doing it here, but it is now going to happen more often.
 */
async function handleRefund(client, event) {
    const email = event.buyer?.email;
    const productId = event.product?.id;
    const productTitle = event.product?.title || productId || "unknown product";

    let discordId = event.clientUtm?.utm_content || null;
    if (!discordId && email) {
        const purchase = getPurchaseForProduct(email, productId);
        discordId = purchase?.discordId || null;
    }

    const did = [];

    if (email) {
        addRefund(email.trim().toLowerCase());
        did.push("blocked from /getrole");

        markStatus(email, productId, {
            productTitle: event.product?.title,
            discordId,
            status: "refunded",
            refundedAt: Date.now(),
        });
    }

    if (discordId && productId) {
        const record = findByOwner(discordId, productId);
        if (record && !record.revoked) {
            setRevoked(record.licenseKey, true);
            did.push(`key ${record.licenseKey} revoked`);
        }
    }

    if (discordId) {
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch({ user: discordId, force: true });
            for (const roleId of getRolesForProduct(productId)) {
                if (!member.roles.cache.has(roleId)) continue;
                await member.roles.remove(roleId);
                did.push(`role ${roleId} removed`);
            }
        } catch (err) {
            console.error(`Refund: could not touch roles for ${discordId}: ${err.message}`);
        }
    } else {
        console.warn("Refund webhook without a resolvable discordId — role and key left alone.");
    }

    console.log(`Refund handled for ${email || "unknown"}: ${did.join(", ") || "nothing to undo"}`);

    await notifyOwner(client,
        `**Refund processed**\n\n• ${email || "unknown"} — ${productTitle}\n` +
        `${did.length ? did.map((d) => `  ‣ ${d}`).join("\n") : "  ‣ nothing needed undoing"}`);
}

/**
 * A chargeback: report it, change nothing.
 *
 * Forced by a bank rather than decided by the seller, and banks get it wrong.
 * Stripping a paying customer over a mistaken dispute costs more than the few
 * minutes it takes to look at one by hand, so this only ever raises a hand.
 */
async function handleChargeback(client, event) {
    const email = event.buyer?.email || "unknown";
    const productTitle = event.product?.title || event.product?.id || "unknown product";
    const amount = event.amount ?? event.receipt?.amount;
    const currency = event.currency || event.receipt?.currency || "";

    await notifyOwner(client,
        `**Chargeback — needs a look**\n\n` +
        `• ${email} — ${productTitle}${amount ? ` (${amount} ${currency})` : ""}\n` +
        `Nothing was taken away automatically. Use \`node add-refund.js ${email}\` if it is genuine.`);
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