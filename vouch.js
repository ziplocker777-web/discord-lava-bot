require("./env.js").loadEnv();

/**
 * Asks buyers who actually used the thing to rate it, and posts what they say.
 *
 * The vouch channel is empty because nobody thinks to write in it unasked. Fifty
 * six people have had a working install for more than three days and not one has
 * been asked what they think.
 *
 * Asked of people who ACTIVATED, not people who paid. Somebody who bought it and
 * never got it working has an opinion, but it is not a review -- it is a support
 * problem, and /pending is where that belongs. Asking them for stars would be
 * both useless and slightly insulting.
 *
 * Five buttons and an optional sentence. Anything longer than one tap is a wall
 * most people will not climb, and a rating with no text is still a rating.
 *
 * Trickled out a few an hour rather than all at once: fifty six DMs inside a
 * minute is what a spam bot looks like, to Discord as much as to a person.
 *
 * Off unless VOUCH=on.
 */

const fs = require("fs");
const path = require("path");
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const axios = require("axios");
const { notifyOwner } = require("./ownerNotify");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

const STORE = path.join(__dirname, "vouchStore.json");
const WATERMARKS = path.join(__dirname, "watermarkStore.json");

const ENABLED = process.env.VOUCH === "on";
const AFTER_DAYS = Number(process.env.VOUCH_AFTER_DAYS || 3);
const PER_SWEEP = Number(process.env.VOUCH_PER_SWEEP || 5);

/**
 * Below this, the rating goes to the owner instead of the channel.
 *
 * Not to hide anything: the channel is a wall of testimonials and always was,
 * and a complaint published there helps nobody -- least of all the person who
 * made it, who wants it fixed rather than framed. Set VOUCH_PUBLIC_MIN=1 to
 * post everything.
 */
const PUBLIC_MIN = Number(process.env.VOUCH_PUBLIC_MIN || 4);

const EVERY_MS = 60 * 60 * 1000;
const STARS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

function load(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function save(data) {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

/** The buyer-facing name: the raw subscription title is never shown to anyone. */
function shownName(title) {
    return title === "Subscription ziplocker" ? "your subscription" : title;
}

/**
 * Discord ids whose subscription has ended.
 *
 * Asking somebody to rate a subscription days after it lapsed is the worst
 * possible moment: the first name in the queue was the man whose key is being
 * taken back on Tuesday. One-off purchases do not expire and are not affected.
 */
async function lapsedIds() {
    const rows = [];
    try {
        for (let page = 0; page < 20; page += 1) {
            const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
            const items = data.items || [];
            rows.push(...items);
            if (items.length < 100) break;
        }
    } catch {
        return new Set();   // unreachable: better to ask nobody wrongly than to stop
    }

    const state = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const id = String(r.clientUtm?.utm_content || "");
        if (!id) continue;
        const e = state.get(id) || { live: false };
        const expired = r.subscriptionDetails?.expiredAt
            ? Date.parse(r.subscriptionDetails.expiredAt) > Date.now()
            : r.subscriptionStatus === "ACTIVE";
        if (expired) e.live = true;
        state.set(id, e);
    }

    return new Set([...state.entries()].filter(([, v]) => !v.live).map(([id]) => id));
}

async function candidates(client) {
    const marks = load(WATERMARKS, {});
    const asked = load(STORE, {});
    const now = Date.now();
    const lapsed = await lapsedIds();

    let owner = null;
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        owner = String(guild.ownerId);
    } catch { /* a nicety, not a requirement */ }

    const picked = new Set();
    const out = [];

    for (const r of Object.values(marks)) {
        const id = String(r.discordId || "");
        if (!id || (owner && id === owner)) continue;
        if (asked[id]) continue;          // one person, one ask, ever
        if (picked.has(id)) continue;     // somebody with two products still gets one

        if (r.revoked) continue;          // their access was taken away
        if (lapsed.has(id)) continue;     // subscription is over: wrong moment entirely

        if (!r.activationCount) continue; // never got it working: not a reviewer
        const since = r.lastActivatedAt || r.createdAt;
        if (!since || now - since < AFTER_DAYS * 86400e3) continue;

        picked.add(id);
        out.push({ discordId: id, email: r.email, product: shownName(r.productTitle), since });
    }

    // Longest-standing first: they have the most to say and are the least likely
    // to still be in the middle of setting it up.
    return out.sort((a, b) => a.since - b.since);
}

function buildAsk(product) {
    return {
        content:
            `You've been using **${product}** for a few days now — how's it going?\n\n` +
            "If you've got five seconds, a rating would genuinely help. There's a box for " +
            "words too, but it's optional.",
        components: [new ActionRowBuilder().addComponents(
            STARS.map((emoji, i) =>
                new ButtonBuilder()
                    .setCustomId(`vouch:${i + 1}`)
                    .setEmoji(emoji)
                    .setStyle(i + 1 >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary))
        )],
    };
}

async function ask(client, person) {
    const store = load(STORE, {});
    store[person.discordId] = {
        askedAt: Date.now(),
        email: person.email,
        product: person.product,
        rating: null,
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
async function handleVouch(interaction, client) {
    const id = interaction.customId || "";
    if (!id.startsWith("vouch:")) return false;

    const part = id.split(":")[1];

    // A star opens the box for words. Required false, so it can be sent empty.
    if (interaction.isButton()) {
        const modal = new ModalBuilder()
            .setCustomId(`vouch:text:${part}`)
            .setTitle(`${part} out of 5 — anything to add?`)
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("words")
                    .setLabel("Optional — leave it blank if you like")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(600)));
        await interaction.showModal(modal);
        return true;
    }

    const rating = Number(id.split(":")[2]);
    const words = (interaction.fields.getTextInputValue("words") || "").trim();

    const store = load(STORE, {});
    const record = store[interaction.user.id] || {};
    record.rating = rating;
    record.words = words;
    record.ratedAt = Date.now();
    store[interaction.user.id] = record;
    save(store);

    await interaction.reply({
        content: rating >= PUBLIC_MIN
            ? "Thank you — posted. That helps more than you'd think."
            : "Thank you — that's gone straight to the owner, who'd rather fix it than frame it.",
        flags: 64,
    });

    const stars = "⭐".repeat(rating) + "▫️".repeat(5 - rating);

    if (rating >= PUBLIC_MIN && process.env.VOUCH_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(process.env.VOUCH_CHANNEL_ID);
            const embed = new EmbedBuilder()
                .setColor(0xFFFFFF)
                .setAuthor({
                    name: interaction.user.globalName || interaction.user.username,
                    iconURL: interaction.user.displayAvatarURL(),
                })
                .setDescription(`${stars}\n\n${words ? `> ${words.replace(/\n/g, "\n> ")}` : "_No words, just the rating._"}`)
                .setFooter({ text: record.product || "" })
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error("[vouch] could not post:", err.message);
            await notifyOwner(client, `**A review could not be posted** (${err.message})\n\n${stars} — ${words || "no words"}`);
        }
        return true;
    }

    await notifyOwner(client,
        `**${rating < PUBLIC_MIN ? "A rating that needs looking at" : "A review"}**\n\n` +
        `${stars} — ${record.product || "unknown"}\n` +
        `• <@${interaction.user.id}> · ${record.email || "no email"}\n\n` +
        (words ? `> ${words.slice(0, 900)}` : "_No words._"));

    return true;
}

function startVouch(client) {
    if (!ENABLED) {
        console.log("[vouch] off (set VOUCH=on to enable)");
        return;
    }

    const run = async () => {
        try {
            const people = (await candidates(client)).slice(0, PER_SWEEP);
            for (const person of people) {
                const ok = await ask(client, person);
                console.log(`[vouch] asked ${person.discordId} about ${person.product} — ${ok ? "sent" : "DMs closed"}`);
            }
        } catch (err) {
            console.error("[vouch] sweep failed:", err.message);
        }
    };

    console.log(`[vouch] on — ${PER_SWEEP} an hour, ${AFTER_DAYS}+ days after activation, ${PUBLIC_MIN}★ and up posted`);
    setTimeout(run, 90_000);
    setInterval(run, EVERY_MS).unref?.();
}

module.exports = { startVouch, handleVouch, candidates, load, STORE };
