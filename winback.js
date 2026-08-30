require("./env.js").loadEnv();

/**
 * Asks people who started buying and stopped what got in the way.
 *
 * These are the only lost sales worth chasing: the person is still on the
 * server, still reachable, and only hours past the moment they were willing to
 * pay. Nine of them are sitting in lava.top right now, worth about eighty
 * dollars, and nobody has ever asked any of them anything.
 *
 * Buttons rather than "reply and tell me". A one-tap answer gets replies from
 * people who would never write a paragraph, the answer arrives structured
 * instead of as free text somebody has to read and file, and nothing has to
 * listen to every DM the bot receives to work out which ones are replies.
 *
 * Three rules it will not break:
 *   nobody is asked twice, ever, about anything
 *   nobody is asked until the checkout has had time to complete on its own
 *   nobody is asked about something they abandoned weeks ago
 *
 * Off unless WINBACK=on. It messages real customers unprompted, which is not a
 * thing to switch on by deploying.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { notifyOwner } = require("./ownerNotify");

const STORE = path.join(__dirname, "winbackStore.json");

const ENABLED = process.env.WINBACK === "on";
const AFTER_HOURS = Number(process.env.WINBACK_AFTER_HOURS || 3);
const MAX_AGE_DAYS = Number(process.env.WINBACK_MAX_AGE_DAYS || 7);
const EVERY_MS = 60 * 60 * 1000;

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

const REASONS = {
    payment: { label: "Payment wouldn't go through", emoji: "💳" },
    price: { label: "Too expensive", emoji: "💰" },
    changed: { label: "Changed my mind", emoji: "🤷" },
    other: { label: "Something else", emoji: "✍️" },
};

function load() {
    try { return JSON.parse(fs.readFileSync(STORE, "utf-8")); } catch { return {}; }
}

function save(data) {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

async function allInvoices() {
    const out = [];
    for (let page = 0; page < 20; page += 1) {
        const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
        const items = data.items || [];
        out.push(...items);
        if (items.length < 100) break;
    }
    return out;
}

/**
 * Who is worth asking.
 *
 * Same filtering as the /abandoned report, plus the two time limits and the
 * record of who has already been asked.
 */
async function candidates(client) {
    const rows = await allInvoices();
    const asked = load();
    const now = Date.now();

    let owner = null;
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        owner = String(guild.ownerId);
    } catch { /* filtering by owner is a nicety, not a requirement */ }

    const completed = new Set();
    for (const r of rows) {
        if (String(r.status).toUpperCase() !== "COMPLETED") continue;
        completed.add(`${String(r.buyer?.email || "").toLowerCase()}|${r.product?.name || ""}`);
    }

    const out = [];
    // Two retries of the same checkout are two rows, and the "once per person"
    // rule above only knows about people already messaged on a previous run --
    // so without this, the very first sweep sends everybody two DMs.
    const picked = new Set();

    for (const r of rows) {
        const status = String(r.status).toUpperCase();
        if (status === "COMPLETED" || status === "FAILED") continue;

        const discordId = String(r.clientUtm?.utm_content || "");
        if (!discordId) continue;                    // nobody to ask
        if (owner && discordId === owner) continue;  // your own testing

        // Once per person, not once per abandoned checkout: somebody who tried
        // three products in one evening gets one message, not three.
        if (asked[discordId]) continue;

        const email = String(r.buyer?.email || "").toLowerCase();
        const product = r.product?.name || "";
        if (completed.has(`${email}|${product}`)) continue;

        const at = Date.parse(r.datetime || r.created || "");
        if (!Number.isFinite(at)) continue;

        const hours = (now - at) / 3600e3;
        if (hours < AFTER_HOURS) continue;              // give it time to finish
        if (hours > MAX_AGE_DAYS * 24) continue;        // too long ago to be worth raising

        if (picked.has(discordId)) continue;
        picked.add(discordId);

        out.push({ discordId, email, product, at, amount: r.receipt?.amount, currency: r.receipt?.currency });
    }

    return out;
}

function buildAsk(product) {
    const rows = [new ActionRowBuilder().addComponents(
        Object.entries(REASONS).map(([key, r]) =>
            new ButtonBuilder()
                .setCustomId(`winback:${key}`)
                .setLabel(r.label)
                .setEmoji(r.emoji)
                .setStyle(key === "other" ? ButtonStyle.Secondary : ButtonStyle.Primary))
    )];

    return {
        content:
            `Hey — you started getting **${product}** a little while ago and it didn't go through.\n\n` +
            "This isn't a sales pitch and there's nothing to click to buy. If something got " +
            "in the way I'd just like to know what, because it's probably getting in " +
            "somebody else's way too.\n\n" +
            "_One tap and you'll never hear from me about this again._",
        components: rows,
    };
}

/** Ask one person. Records the attempt either way, so a closed DM is not retried for ever. */
async function ask(client, person) {
    const store = load();
    store[person.discordId] = {
        askedAt: Date.now(),
        email: person.email,
        product: person.product,
        answered: null,
    };

    try {
        const user = await client.users.fetch(person.discordId);
        await user.send(buildAsk(person.product));
        store[person.discordId].sent = true;
    } catch (err) {
        store[person.discordId].sent = false;
        store[person.discordId].error = err.message;
    }

    save(store);
    return store[person.discordId].sent;
}

/** @returns {Promise<boolean>} whether this interaction was one of ours */
async function handleWinback(interaction, client) {
    const id = interaction.customId || "";
    if (!id.startsWith("winback:")) return false;

    const key = id.split(":")[1];

    if (key === "other" && interaction.isButton()) {
        const modal = new ModalBuilder()
            .setCustomId("winback:modal")
            .setTitle("What got in the way?")
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("why")
                    .setLabel("In your own words")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)));
        await interaction.showModal(modal);
        return true;
    }

    let answer;
    if (key === "modal") {
        answer = interaction.fields.getTextInputValue("why");
    } else {
        answer = REASONS[key]?.label || key;
    }

    const store = load();
    const record = store[interaction.user.id] || {};
    record.answered = answer;
    record.answeredAt = Date.now();
    store[interaction.user.id] = record;
    save(store);

    await interaction.reply({
        content: "Thanks — that's genuinely useful. That's the last you'll hear from me about it.",
        flags: 64,
    });

    await notifyOwner(client,
        `**Someone said why they didn't buy**\n\n` +
        `• <@${interaction.user.id}> — ${record.product || "unknown product"}\n` +
        `• ${record.email || "no email"}\n\n` +
        `> ${String(answer).slice(0, 900)}`);

    return true;
}

/** The hourly sweep. Does nothing at all unless WINBACK=on. */
function startWinback(client) {
    if (!ENABLED) {
        console.log("[winback] off (set WINBACK=on to enable)");
        return;
    }

    const run = async () => {
        try {
            const people = await candidates(client);
            for (const person of people) {
                const ok = await ask(client, person);
                console.log(`[winback] asked ${person.discordId} about ${person.product} — ${ok ? "sent" : "DMs closed"}`);
            }
        } catch (err) {
            console.error("[winback] sweep failed:", err.message);
        }
    };

    console.log(`[winback] on — asking after ${AFTER_HOURS}h, ignoring anything older than ${MAX_AGE_DAYS}d`);
    setTimeout(run, 60_000);
    setInterval(run, EVERY_MS).unref?.();
}

module.exports = { startWinback, handleWinback, candidates, ask, load };
