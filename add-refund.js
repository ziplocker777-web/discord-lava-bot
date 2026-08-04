require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { addRefund } = require("./refundedEmails");
const { getPurchase } = require("./purchaseStore");
const { getRolesForProduct } = require("./roles");

const EMAIL = process.argv[2];

if (!EMAIL) {
    console.error("Использование: node add-refund.js email@example.com");
    process.exit(1);
}

const normalized = EMAIL.trim().toLowerCase();
addRefund(normalized);
console.log(`Добавлено в refundedEmails.json: ${normalized}`);

const purchase = getPurchase(normalized);

if (!purchase) {
    console.log("Локальной записи о покупке нет — снимать роль не с кого. Email заблокирован для будущих /getrole и /panelredownload.");
    process.exit(0);
}

if (!purchase.discordId) {
    console.log("В записи нет discordId — роль придётся снять вручную, если она вообще была выдана.");
    process.exit(0);
}

// purchaseStore.json хранит ОДНУ (последнюю) запись на email — если человек
// покупал несколько разных товаров, здесь будет только последний. Снимаем
// роли ровно для этого товара, теми же правилами, что их выдают (roles.js) —
// если он владеет ещё чем-то под тем же email, придётся довыдать вручную.
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
