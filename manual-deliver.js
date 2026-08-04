require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { recordPurchase } = require("./purchaseStore");
const { getRolesForProduct } = require("./roles");
const { deliverPurchase, buildDeliveryMessage } = require("./delivery");
const { WATERMARKED_PRODUCT_IDS } = require("./webhookServer");
const KNOWN_PRODUCT_IDS = require("./products");

// Admin override for purchases made before this whole system existed (no webhook
// record, no lava.top sales-API match) — records the purchase, grants the role, and
// DMs the same download link + license key a normal buyer would get automatically.
const [, , email, discordId, ...titleParts] = process.argv;
const productTitle = titleParts.join(" ");

if (!email || !discordId || !productTitle) {
    console.error('Использование: node manual-deliver.js email@example.com discordId "Точное название товара"');
    console.error("Доступные названия:", Object.keys(KNOWN_PRODUCT_IDS).join(", "));
    process.exit(1);
}

const productId = KNOWN_PRODUCT_IDS[productTitle];
if (!productId) {
    console.error(`Неизвестное название товара: "${productTitle}"`);
    console.error("Доступные:", Object.keys(KNOWN_PRODUCT_IDS).join(", "));
    process.exit(1);
}

if (!WATERMARKED_PRODUCT_IDS.has(productId)) {
    console.error(`"${productTitle}" не входит в список товаров с доставкой конфигуратора — выдавать через этот скрипт нечего.`);
    process.exit(1);
}

const normalizedEmail = email.trim().toLowerCase();

recordPurchase(normalizedEmail, {
    productId,
    productTitle,
    discordId,
    contractId: `manual-${Date.now()}`,
});
console.log(`Покупка записана вручную: ${normalizedEmail} -> ${productTitle} (${discordId})`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch({ user: discordId, force: true });

        const roleIds = getRolesForProduct(productId);
        for (const roleId of roleIds) {
            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId);
                console.log(`Роль ${roleId} выдана.`);
            }
        }

        const { downloadUrl, licenseKey } = deliverPurchase({
            email: normalizedEmail,
            discordId,
            productId,
            productTitle,
        });

        try {
            const user = await client.users.fetch(discordId);
            await user.send(buildDeliveryMessage({
                productId,
                productTitle,
                downloadUrl,
                licenseKey,
                greeting: "Thanks for your purchase!",
            }));
            console.log(`Готово — ссылка и ключ отправлены ${discordId} в личные сообщения.`);
        } catch (dmErr) {
            // Токен уже создан, даже если DM не дошло (закрытые ЛС и т.п.) — выводим
            // ссылку и ключ прямо тут, чтобы не лезть в watermarkStore.json руками.
            console.error("DM не доставлено:", dmErr.message);
            console.log("Ссылку и ключ придётся передать вручную (например, в тикете):");
            console.log("  Download:", downloadUrl);
            console.log("  License key:", licenseKey);
        }
    } catch (err) {
        console.error("Не удалось выдать вручную:", err.message);
    } finally {
        process.exit(0);
    }
});

client.login(process.env.DISCORD_TOKEN);
