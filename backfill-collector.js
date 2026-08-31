require("./env.js").loadEnv();

/**
 * Hand the Collector badge to everybody who already earned it.
 *
 * One-off. From here on collector.js does this at the moment a second product is
 * paid for; this exists only because the badge was invented after the purchases.
 *
 * Prints what it would do and changes nothing unless given --apply.
 */

const { Client, GatewayIntentBits } = require("discord.js");
const { MIN_PRODUCTS, productCount } = require("./collector");

const APPLY = process.argv.includes("--apply");
const QUIET = process.argv.includes("--no-dm");

const db = require("./purchaseStore.json");
const ROLE = process.env.COLLECTOR_ROLE_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const ownerId = String(guild.ownerId);

    if (!ROLE) { console.error("COLLECTOR_ROLE_ID не задан"); process.exit(1); }

    // Judged by the same function the live grant uses, so the backfill and the
    // automatic path can never disagree about who has earned it.
    const earned = [];
    for (const [email, list] of Object.entries(db)) {
        if (!Array.isArray(list) || !list.length) continue;
        const discordId = list.map((p) => p.discordId).filter(Boolean)[0];
        const n = productCount(email, discordId);
        if (n < MIN_PRODUCTS) continue;
        earned.push({ email, discordId, products: list.map((p) => p.productTitle || "?"), n });
    }

    // One person with two addresses would otherwise be processed twice.
    const byPerson = new Map();
    for (const p of earned) {
        if (p.discordId && byPerson.has(p.discordId)) continue;
        byPerson.set(p.discordId || p.email, p);
    }
    earned.length = 0;
    earned.push(...byPerson.values());

    console.log(`порог: ${MIN_PRODUCTS} разных товара`);
    console.log(`заслужили: ${earned.length}\n`);

    const granted = [], already = [], missing = [], skipped = [];

    for (const p of earned) {
        if (!p.discordId) { missing.push({ ...p, why: "Discord не привязан" }); continue; }
        if (p.discordId === ownerId) { skipped.push(p); continue; }

        let member;
        try {
            member = await guild.members.fetch({ user: p.discordId, force: true });
        } catch {
            missing.push({ ...p, why: "вышел с сервера" });
            continue;
        }

        if (member.roles.cache.has(ROLE)) { already.push(p); continue; }

        if (APPLY) {
            try {
                await member.roles.add(ROLE);
                if (!QUIET) {
                    await member.send(
                        "**Collector**\n\n"
                        + "You own more than one thing from here now, so the badge is on your name.\n\n"
                        + "Nothing to do. It's yours for good.").catch(() => {});
                }
            } catch (err) {
                missing.push({ ...p, why: "не удалось выдать: " + err.message });
                continue;
            }
        }
        granted.push({ ...p, name: member.user.username });
    }

    const show = (title, list, extra = () => "") => {
        if (!list.length) return;
        console.log(`\n${title} (${list.length}):`);
        for (const p of list) console.log(`  ${p.email.padEnd(34)} ${p.n ?? p.products.length} товара  ${extra(p)}`);
    };

    show(APPLY ? "ВЫДАНО" : "будет выдано", granted, (p) => p.name || "");
    show("уже есть", already);
    show("владелец, пропущен", skipped);
    show("не достать", missing, (p) => p.why);

    if (!APPLY) console.log("\nвхолостую. запусти с --apply, чтобы выдать.");

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
