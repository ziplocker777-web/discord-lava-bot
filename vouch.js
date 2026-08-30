require("./env.js").loadEnv();

/**
 * Asks buyers who actually used the thing to rate it, and posts what they say.
 *
 * Fourteen people had written one unprompted before any of this existed, which
 * is fourteen out of several hundred. Fifty six more have had a working install
 * for over three days and have never been asked what they think.
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
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
    TextDisplayBuilder, ThumbnailBuilder, MessageFlags,
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

// Gold for a review, so a wall of them reads as one thing at a glance.
const GOLD = 0xF0B232;
const WHITE = 0xFFFFFF;

function load(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function save(data) {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

/**
 * A name that will actually be visible above a review.
 *
 * Discord display names can be made of characters no font draws. One of the
 * first reviewers had set theirs to U+1CBC, an unassigned slot in the Georgian
 * block: the embed carried the name correctly and the channel showed a blank
 * space above the stars.
 *
 * Chasing individual codepoints is a losing game -- there are thousands, and a
 * new one every Unicode release. The rule is inverted instead: a name has to
 * contain at least one character from a script somebody actually reads,
 * otherwise it is not a name as far as this is concerned.
 */
const READABLE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Nd}]/u;

// The handful of blanks that live inside a real script and so pass the test
// above: the Hangul fillers are the classic way to have no name at all.
const FILLERS = /[ᅠᅟㅤﾠ]/gu;

function displayName(user) {
    const usable = (v) => {
        const trimmed = String(v || "").trim();
        return READABLE.test(trimmed.replace(FILLERS, "")) ? trimmed : null;
    };

    return usable(user.globalName) || usable(user.username) || "A buyer";
}

/**
 * What lava.top knows about each subscriber: whether it is still running, and
 * which tier it is.
 *
 * Both come from the same sweep because both are needed for the same person.
 * The tier has to come from here rather than from our own records: the offer
 * name is on every invoice, while `tier` was added to purchaseStore later and
 * only one of the eighteen subscription records carries it.
 */
async function subInfo() {
    const rows = [];
    try {
        for (let page = 0; page < 20; page += 1) {
            const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
            const items = data.items || [];
            rows.push(...items);
            if (items.length < 100) break;
        }
    } catch {
        return new Map();   // unreachable: better to ask nobody wrongly than to stop
    }

    const state = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const id = String(r.clientUtm?.utm_content || "");
        if (!id) continue;
        const e = state.get(id) || { live: false, offer: null };
        const running = r.subscriptionDetails?.expiredAt
            ? Date.parse(r.subscriptionDetails.expiredAt) > Date.now()
            : r.subscriptionStatus === "ACTIVE";
        if (running) e.live = true;
        if (r.product?.offer) e.offer = r.product.offer;
        state.set(id, e);
    }

    return state;
}

/** "Membership subscription", or the product's own name for anything else. */
function labelFor(title, offer) {
    if (title !== "Subscription ziplocker") return title;
    return offer ? `${offer} subscription` : "subscription";
}

async function candidates(client) {
    const marks = load(WATERMARKS, {});
    const asked = load(STORE, {});
    const now = Date.now();
    const subs = await subInfo();

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

        // A subscription that has ended is the worst possible moment to ask.
        const sub = subs.get(id);
        if (sub && !sub.live) continue;

        if (!r.activationCount) continue; // never got it working: not a reviewer
        const since = r.lastActivatedAt || r.createdAt;
        if (!since || now - since < AFTER_DAYS * 86400e3) continue;

        picked.add(id);
        out.push({
            discordId: id,
            email: r.email,
            product: labelFor(r.productTitle, sub?.offer),
            since,
        });
    }

    // Longest-standing first: they have the most to say and are the least likely
    // to still be in the middle of setting it up.
    return out.sort((a, b) => a.since - b.since);
}

/**
 * One posted review.
 *
 * Built with Discord's own container rather than an embed, for the divider: a
 * line drawn out of ─ characters is a fixed width in a place that is not, so it
 * wrapped on phones. The real separator is drawn by Discord at whatever width
 * the reader has.
 *
 * The stars sit in a heading because that is the only way to make them bigger.
 * Emoji take the size of the text around them, and in an embed that size is
 * fixed no matter which field they are in.
 */
function buildReview(user, rating, words, product, at) {
    const container = new ContainerBuilder()
        .setAccentColor(GOLD)
        .addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${displayName(user)}**`),
                    new TextDisplayBuilder().setContent(`## ${"⭐".repeat(rating)}`),
                    new TextDisplayBuilder().setContent(
                        words || "Rating only, no words."))
                // A face at this size is the difference between a row of
                // messages and a row of people.
                .setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(user.displayAvatarURL({ size: 128 }))))
        // The line divides the review from what the review is about, which is
        // the only division there is: the name, the score and the words are one
        // thought and belong on one side of it.
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# ${product || ""} · <t:${Math.floor((at || Date.now()) / 1000)}:R>`));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * The panel that sits in the vouch channel.
 *
 * A standing invitation beats a message in everyone's DMs: nobody is
 * interrupted, and the people who feel like saying something find it exactly
 * where the other reviews are.
 *
 * It has to be the last message in the channel or nobody sees it, so it is
 * moved down after every review rather than left to sink.
 */
function buildPanel() {
    const container = new ContainerBuilder()
        .setAccentColor(WHITE)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("## ⭐  Leave a review"))
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(true)
                .setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "Bought something here? Rate it out of 5.\n" +
                "You can add a few words if you want.\n" +
                "-# Reviews appear in this channel."))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vouch:open")
                    .setLabel("Write a review")
                    .setEmoji("✍️")
                    .setStyle(ButtonStyle.Success)));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Put the panel at the bottom of the channel, removing the previous one.
 *
 * Deleted rather than edited, because an edited message stays where it was and
 * the whole point is to be underneath the newest review.
 */
async function movePanel(client) {
    const channelId = process.env.VOUCH_CHANNEL_ID;
    if (!channelId) return null;

    const channel = await client.channels.fetch(channelId);
    const store = load(STORE, {});
    const previous = store.__panel;

    const sent = await channel.send(buildPanel());

    if (previous) {
        try {
            const old = await channel.messages.fetch(previous);
            await old.delete();
        } catch { /* already gone, which is the state we wanted anyway */ }
    }

    store.__panel = sent.id;
    save(store);
    return sent.id;
}

function buildAsk(product) {
    return {
        content:
            `How's **${product}** working out?\n\n` +
            "If you've got a minute, rate it out of 5. You can add a few words too.",
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vouch:open")
                .setLabel("Write a review")
                .setEmoji("✍️")
                .setStyle(ButtonStyle.Success)
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

    // The form carries the score as well as the words, because a Discord form
    // holds text boxes and nothing else -- there is no way to put five stars
    // inside one. A typed digit is the price of having the words be visible.
    if (interaction.isButton()) {
        const store = load(STORE, {});
        const already = store[interaction.user.id];

        if (already && already.rating) {
            return interaction.reply({
                content: `You've already left ${"⭐".repeat(already.rating)} — thank you. One each.`,
                flags: 64,
            }).then(() => true);
        }

        // The panel is public, so anybody can press it. A wall of reviews from
        // people who never bought anything is worth less than an empty wall.
        const owns = Object.values(load(WATERMARKS, {}))
            .some((m) => String(m.discordId) === interaction.user.id);

        if (!owns) {
            return interaction.reply({
                content: "This is for people who've bought something — you're not on the list yet.",
                flags: 64,
            }).then(() => true);
        }

        const modal = new ModalBuilder()
            .setCustomId("vouch:submit")
            .setTitle("Leave a review")
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("rating")
                        .setLabel("Score out of 5")
                        .setPlaceholder("5")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(1)),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("words")
                        .setLabel("Anything to add? (optional)")
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setMaxLength(600)));
        await interaction.showModal(modal);
        return true;
    }

    const rating = Number((interaction.fields.getTextInputValue("rating") || "").trim());
    const words = (interaction.fields.getTextInputValue("words") || "").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        await interaction.reply({
            content: "That needs to be a whole number from 1 to 5. Press the button again.",
            flags: 64,
        });
        return true;
    }

    const store = load(STORE, {});
    const record = store[interaction.user.id] || {};

    // Clicked from the channel rather than a DM, so the product was never
    // established. Their newest purchase is the one they have most recently
    // formed an opinion about.
    if (!record.product) {
        const marks = Object.values(load(WATERMARKS, {}))
            .filter((m) => String(m.discordId) === interaction.user.id)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (marks[0]) {
            const subs = await subInfo();
            record.product = labelFor(marks[0].productTitle, subs.get(interaction.user.id)?.offer);
            record.email = marks[0].email;
        }
    }
    record.rating = rating;
    record.words = words;
    record.ratedAt = Date.now();
    store[interaction.user.id] = record;
    save(store);

    await interaction.reply({
        content: rating >= PUBLIC_MIN
            ? "Thanks, it's up in the channel."
            : "Thanks. This one's gone to the owner directly.",
        flags: 64,
    });

    const stars = "⭐".repeat(rating);

    if (rating >= PUBLIC_MIN && process.env.VOUCH_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(process.env.VOUCH_CHANNEL_ID);
            await channel.send(buildReview(interaction.user, rating, words, record.product));

            // Straight back to the bottom, under the review that just landed.
            await movePanel(client).catch(() => {});
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

module.exports = {
    startVouch, handleVouch, candidates, movePanel, buildReview, displayName, load, STORE,
};
