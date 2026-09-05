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
const { notifyOwner, named } = require("./ownerNotify");
const { isOwn, isRealDiscordId } = require("./ownAccounts");
const { writeJson } = require("./jsonStore");

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
    writeJson(STORE, data);
}

async function allInvoices() {
    const out = [];
    const seen = new Set();
    for (let page = 0; page < 20; page += 1) {
        const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
        const items = data.items || [];

        // lava.top numbers its pages from one, so asking for page 0 and page 1
        // returns the same hundred rows. Every total built on this list counted
        // the first hundred invoices twice: 157 sales and $1392 where the truth
        // was 104 and $944.
        //
        // Deduplicated by id rather than switched to 1-based paging, because the
        // id is true whatever the API decides to call its first page -- and a
        // gateway that changes its mind about this again cannot break the
        // numbers a second time.
        const fresh = items.filter((r) => {
            if (!r.id) return true;          // cannot dedupe it; keeping it is the safer error
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
        out.push(...fresh);

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
/**
 * The line before which nobody is asked, drawn the first time anybody looks.
 *
 * Somebody who gave up a week ago has forgotten this shop exists, and a message
 * about it reads as strange rather than helpful. The backlog is therefore left
 * alone for good: only people who walk away from a checkout from here onwards
 * are ever asked about it.
 */
function startLine() {
    const store = load();
    if (!store.__since) {
        store.__since = Date.now();
        save(store);
    }
    return store.__since;
}

async function candidates(client) {
    const rows = await allInvoices();
    const asked = load();
    const now = Date.now();
    const since = startLine();

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
        // "0" is what the payment check puts on its invoices, and "0" is a truthy
        // string -- enough to clear a plain falsy guard and end up being messaged.
        if (!isRealDiscordId(discordId)) continue;   // nobody to ask
        if (owner && discordId === owner) continue;  // your own testing
        if (isOwn(r.buyer?.email, discordId)) continue;

        // Once per person, not once per abandoned checkout: somebody who tried
        // three products in one evening gets one message, not three.
        if (discordId.startsWith("__")) continue;
        if (asked[discordId]) continue;

        const email = String(r.buyer?.email || "").toLowerCase();
        const product = r.product?.name || "";
        if (completed.has(`${email}|${product}`)) continue;

        // "Subscription ziplocker" is the raw lava.top name shared by all three
        // tiers and is never shown to a buyer -- they know it as Membership or
        // Premium, which is what the offer says.
        const shown = product === "Subscription ziplocker"
            ? `${r.product?.offer || "subscription"} subscription`
            : product;

        const at = Date.parse(r.datetime || r.created || "");
        if (!Number.isFinite(at)) continue;

        if (at < since) continue;                       // the backlog is not ours to reopen

        const hours = (now - at) / 3600e3;
        if (hours < AFTER_HOURS) continue;              // give it time to finish
        if (hours > MAX_AGE_DAYS * 24) continue;        // too long ago to be worth raising

        if (picked.has(discordId)) continue;
        picked.add(discordId);

        out.push({ discordId, email, product, shown, at, amount: r.receipt?.amount, currency: r.receipt?.currency });
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
            `You started buying **${product}** and it didn't go through.\n\n` +
            "Not a sales pitch, and there's nothing here to buy. If something got in the " +
            "way, it'd help to know what — it's probably tripping up other people too.\n\n" +
            "_One tap, and that's the end of it._",
        components: rows,
    };
}

/** Ask one person. Records the attempt either way, so a closed DM is not retried for ever. */
async function ask(client, person) {
    const store = load();
    store[person.discordId] = {
        askedAt: Date.now(),
        email: person.email,
        product: person.shown || person.product,
        answered: null,
    };

    try {
        const user = await client.users.fetch(person.discordId);
        await user.send(buildAsk(person.shown || person.product));
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
        content: "Thanks, that's useful. That's the last of it.",
        flags: 64,
    });

    await notifyOwner(client,
        `**Someone said why they didn't buy**\n\n` +
        `• ${await named(client, interaction.user.id)} — ${record.product || "unknown product"}\n` +
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

module.exports = { startWinback, handleWinback, candidates, ask, load, startLine };
