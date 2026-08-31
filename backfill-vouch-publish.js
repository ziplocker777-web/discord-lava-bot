require("./env.js").loadEnv();

/**
 * Put the reviews that were held back into the channel.
 *
 * They were written while ratings below four went to the owner instead of the
 * wall. That threshold is gone -- a wall of nothing but five stars reads as
 * filtered, and a three among them is what makes the rest believable -- so the
 * ones already on file belong there too.
 *
 * The owner's own ratings are skipped. They are excluded from the average for
 * the same reason: the shop is not one of its own customers.
 *
 * Oldest first, so the channel still reads in the order things were said.
 *
 * Prints what it would do and changes nothing unless given --apply.
 */

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { buildReview, movePanel, displayName } = require("./vouch.js");

const APPLY = process.argv.includes("--apply");
const STORE = path.join(__dirname, "vouchStore.json");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
    const channel = await client.channels.fetch(process.env.VOUCH_CHANNEL_ID);
    const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));

    const waiting = Object.entries(store)
        .filter(([id, r]) => !id.startsWith("__") && r && r.rating && !r.messageId && !r.owner)
        .sort((a, b) => (a[1].ratedAt || 0) - (b[1].ratedAt || 0));

    const skipped = Object.entries(store)
        .filter(([id, r]) => !id.startsWith("__") && r && r.rating && !r.messageId && r.owner);

    console.log(`ждут публикации: ${waiting.length}`);
    if (skipped.length) console.log(`пропускаю оценок владельца: ${skipped.length}`);
    console.log();

    for (const [id, r] of waiting) {
        let user;
        try {
            user = await client.users.fetch(id);
        } catch {
            console.log(`  ${r.rating}★  ${id} — пользователь не найден, пропускаю`);
            continue;
        }

        console.log(`  ${r.rating}★  ${displayName(user).padEnd(22)} ${r.product || "?"}  ${r.words ? JSON.stringify(r.words).slice(0, 50) : "без текста"}`);

        if (!APPLY) continue;

        const sent = await channel.send(buildReview(user, r.rating, r.words, r.product, r.ratedAt));
        store[id].messageId = sent.id;
        fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
    }

    if (APPLY && waiting.length) {
        // Straight back to the bottom, under everything that just landed.
        await movePanel(client).catch(() => {});
        console.log("\nопубликовано, панель оценки возвращена вниз");
    } else if (!APPLY) {
        console.log("\nвхолостую. --apply чтобы опубликовать.");
    }

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
