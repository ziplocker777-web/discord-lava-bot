require("./env.js").loadEnv();

/**
 * Attach every review already in the channel to the person who wrote it.
 *
 * Reviews written before the store kept a message id have none, so the first
 * time one of those thirteen people changed their rating the bot would have
 * posted a second review beside the first instead of editing it.
 *
 * Matched on the avatar in the review, because the URL carries the author's id:
 * cdn.discordapp.com/avatars/<user id>/<hash>. Somebody on a default avatar has
 * no id in the URL, so those fall back to the display name printed above the
 * stars -- which is exactly the name buildReview put there.
 *
 * Prints what it would do and changes nothing unless given --apply.
 */

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { displayName } = require("./vouch.js");

const APPLY = process.argv.includes("--apply");
const STORE = path.join(__dirname, "vouchStore.json");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
    const channel = await client.channels.fetch(process.env.VOUCH_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 100 });

    const store = JSON.parse(fs.readFileSync(STORE, "utf-8"));
    const rated = Object.entries(store)
        .filter(([id, r]) => !id.startsWith("__") && r && r.rating);

    // Name -> id, for the ones whose avatar cannot say who they are.
    const byName = new Map();
    for (const [id] of rated) {
        try {
            const user = await client.users.fetch(id);
            byName.set(displayName(user).toLowerCase(), id);
        } catch { /* gone */ }
    }

    const found = [];
    const puzzling = [];

    for (const message of messages.values()) {
        if (!message.author.bot) continue;

        const raw = JSON.stringify(message.components || []);
        if (!raw.includes("⭐")) continue;          // not a review

        const byAvatar = raw.match(/avatars\/(\d+)\//);
        let userId = byAvatar ? byAvatar[1] : null;

        if (!userId) {
            const name = raw.match(/\*\*([^*]+)\*\*/);
            if (name) userId = byName.get(name[1].trim().toLowerCase()) || null;
        }

        if (!userId || !store[userId]) { puzzling.push(message.id); continue; }
        found.push({ userId, messageId: message.id, rating: store[userId].rating });
    }

    console.log(`отзывов в канале, узнано: ${found.length}`);
    for (const f of found) {
        const had = store[f.userId].messageId;
        console.log(`  ${f.userId}  ${"⭐".repeat(f.rating)}  ${had === f.messageId ? "уже связан" : "-> " + f.messageId}`);
        if (APPLY) store[f.userId].messageId = f.messageId;
    }

    if (puzzling.length) console.log(`\nне удалось опознать: ${puzzling.length} (${puzzling.join(", ")})`);

    const without = rated.filter(([id]) => !store[id].messageId && !found.some((f) => f.userId === id));
    if (without.length) {
        console.log(`\nбез сообщения в канале: ${without.length} — это оценки ниже ${process.env.VOUCH_PUBLIC_MIN || 4}, их там и не должно быть`);
    }

    if (APPLY) {
        fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
        console.log("\nзаписано");
    } else {
        console.log("\nвхолостую. --apply чтобы записать.");
    }

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
