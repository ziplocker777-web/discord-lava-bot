require("dotenv").config();
const express = require("express");
const { recordPurchase } = require("./purchaseStore");

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

// client передаём из index.js, чтобы иметь доступ к guild/member для выдачи роли
function startWebhookServer(client) {
    const app = express();
    app.use(express.json());

    app.post("/webhook/lava", checkApiKey, async (req, res) => {
        console.log("========== WEBHOOK ==========");
        console.log("Body:", JSON.stringify(req.body, null, 2));

        const event = req.body;

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
                await grantRole(client, discordId).catch(err => {
                    console.error("Role grant failed:", err);
                });
            } else {
                console.warn("Webhook without discordId in clientUtm.utm_content — role not granted automatically.");
            }
        }

        res.sendStatus(200);
    });

    const port = process.env.PORT || 3000;

    app.listen(port, () => {
        console.log(`Webhook server listening on port ${port}`);
    });
}

async function grantRole(client, discordId) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const roleId = process.env.ROLE_ID;

    if (member.roles.cache.has(roleId)) {
        console.log(`${discordId} already has the role.`);
        return;
    }

    await member.roles.add(roleId);
    console.log(`Role granted to ${discordId}`);
}

module.exports = { startWebhookServer };
