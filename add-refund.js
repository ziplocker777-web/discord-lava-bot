require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { addRefund } = require("./refundedEmails");
const { getPurchaseForProduct, getAllPurchases } = require("./purchaseStore");
const { getRolesForProduct } = require("./roles");
const KNOWN_PRODUCT_IDS = require("./products");

// Note: refundedEmails.json still blocks the WHOLE email from future /getrole and
// /panelredownload verification, not just the refunded product — if this email also
// owns something else legitimately, that purchase becomes unreachable through
// self-serve too. Rare enough in practice that this hasn't been split per-product;
// worth revisiting if a genuinely mixed refund/keep case comes up.
const EMAIL = process.argv[2];
const PRODUCT_TITLE = process.argv.slice(3).join(" ");

if (!EMAIL) {
    console.error('Использование: node add-refund.js email@example.com ["Название товара"]');
    console.error("Название товара обязательно, если на email больше одной покупки.");
    console.error("Доступные названия:", Object.keys(KNOWN_PRODUCT_IDS).join(", "));
    process.exit(1);
}

const normalized = EMAIL.trim().toLowerCase();
addRefund(normalized);
console.log(`Добавлено в refundedEmails.json: ${normalized}`);

let purchase;
if (PRODUCT_TITLE) {
    const productId = KNOWN_PRODUCT_IDS[PRODUCT_TITLE];
    if (!productId) {
        console.error(`Неизвестное название товара: "${PRODUCT_TITLE}"`);
        console.error("Доступные:", Object.keys(KNOWN_PRODUCT_IDS).join(", "));
        process.exit(1);
    }
    purchase = getPurchaseForProduct(normalized, productId);
} else {
    const all = getAllPurchases(normalized);
    if (all.length > 1) {
        console.error(`У ${normalized} несколько покупок — укажи, какую именно рефандят:`);
        for (const p of all) console.error(`  - ${p.productTitle || p.productId}`);
        process.exit(1);
    }
    purchase = all[0] || null;
}

if (!purchase) {
    console.log("Локальной записи об этой покупке нет — снимать роль не с кого. Email заблокирован для будущих /getrole и /panelredownload.");
    process.exit(0);
}

if (!purchase.discordId) {
    console.log("В записи нет discordId — роль придётся снять вручную, если она вообще была выдана.");
    process.exit(0);
}

const roleIds = getRolesForProduct(purchase.productId);

if (roleIds.length === 0) {
    console.log("Для этого товара роли не настроены — снимать нечего.");
    process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch({ user: purchase.discordId, force: true });

        let removedAny = false;
        for (const roleId of roleIds) {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
                console.log(`Роль ${roleId} снята с ${purchase.discordId}.`);
                removedAny = true;
            }
        }
        if (!removedAny) console.log(`У ${purchase.discordId} и так не было этих ролей.`);
    } catch (err) {
        console.error("Не удалось снять роль автоматически:", err.message);
        console.error("Сними вручную в Discord, если нужно.");
    } finally {
        process.exit(0);
    }
});

client.login(process.env.DISCORD_TOKEN);
