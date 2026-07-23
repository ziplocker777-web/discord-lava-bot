require("dotenv").config();
const express = require("express");
const { recordPurchase } = require("./purchaseStore");
const { getRolesForProduct } = require("./roles");

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
            if (event.eventType === "payment.success" && event.status === "completed") {
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
                    // Оборачиваем выдачу роли, чтобы ошибка Дискорда не вешала запрос
                    try {
                        await grantRole(client, discordId, event.product?.id);
                    } catch (err) {
                        console.error("Role grant failed inside Discord:", err.message);
                    }
                } else {
                    console.warn("Webhook without discordId in clientUtm.utm_content — role not granted automatically.");
                }

                // ВСЕГДА отвечаем 200 на успешный платеж, чтобы Lava остановила спам
                return res.sendStatus(200);
            } else {
                // Игнорируем другие типы событий (например, payment.failed) с кодом 200
                console.log(`Event ${event.eventType} ignored.`);
                return res.sendStatus(200);
            }
        } catch (error) {
            console.error("Critical error inside webhook processing:", error);
            // Возвращаем 200 даже при ошибке, чтобы Lava не долбила сервер бесконечно
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

module.exports = { startWebhookServer };