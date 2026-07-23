require("dotenv").config();
const express = require("express");
const { recordPurchase, getPurchase } = require("./purchaseStore");
const { getRolesForProduct, getRolesToRevokeOnCancellation } = require("./roles");

// Список типов событий, которые означают успешную оплату/оформление
const SUCCESS_EVENT_TYPES = [
    "payment.success",
    "invoice.paid",
    "purchase.success",
    "subscription.created",
    "subscription.active",
    "subscription.renewed"
];

// Список типов событий, которые означают отмену подписки
const CANCELLATION_EVENT_TYPES = [
    "subscription.cancelled",
    "subscription.canceled",
    "subscription.recurring.cancelled",
    "subscription.recurring.canceled",
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

function isSubscriptionCancellationEvent(event) {
    const type = (event.eventType || "").toLowerCase();
    if (!type) return false;

    if (CANCELLATION_EVENT_TYPES.includes(type)) return true;

    // Loose fallback для отмен
    return type.includes("subscription") && (type.includes("cancel") || type.includes("fail"));
}

function checkApiKey(req, res, next) {
    const key = req.header("X-Api-Key");

    if (!key) {
        return res.status(401).send("Missing API Key");
    }

    if (key !== process.env.WEBHOOK_API_KEY) {
        return res.status(401).send("Invalid API Key");
    }

    next();
}

function startWebhookServer(client) {
    const app = express();
    app.use(express.json());

    app.post("/webhook/lava", checkApiKey, async (req, res) => {
        console.log("========== WEBHOOK ==========");
        console.log("Body:", JSON.stringify(req.body, null, 2));

        const event = req.body;

        try {
            if (isPaymentSuccessEvent(event)) {
                console.log(`Payment success event received: ${event.eventType}`);

                const email = event.buyer?.email;
                const discordId = event.clientUtm?.utm_content || null;

                if (email) {
                    recordPurchase(email, {
                        productId: event.product?.id,
                        productTitle: event.product?.title,
                        contractId: event.contractId,
                        timestamp: event.timestamp,
                        discordId
                    });

                    console.log(`Purchase recorded for ${email} (discordId: ${discordId || "—"})`);
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

                return res.sendStatus(200);
            } else if (isSubscriptionCancellationEvent(event)) {
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

    const port = process.env.PORT || 3000;

    app.listen(port, () => {
        console.log(`Webhook server listening on port ${port}`);
    });
}

async function grantRole(client, discordId, productId) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);

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
    const member = await guild.members.fetch(discordId);

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

module.exports = { startWebhookServer, revokeRole };