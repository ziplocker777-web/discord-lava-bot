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
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
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

    return usable(user.globalName) || usable(user.username) || "A customer";
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
    const seen = new Set();
    try {
        for (let page = 0; page < 20; page += 1) {
            const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
            const items = data.items || [];

            // lava.top pages from one: page 0 and page 1 are the same hundred
            // rows. Deduplicated by id, as everywhere else that reads this list.
            const fresh = items.filter((r) => {
                if (!r.id) return true;
                if (seen.has(r.id)) return false;
                seen.add(r.id);
                return true;
            });
            rows.push(...fresh);

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

// ========================== RATINGS ON THE PANELS ==========================
//
// Ten people have rated Muzzle Core FX and the average came out at 4.7, which
// nobody shopping could see: it lived in a channel you have to already care
// enough to open. A shop page that says nothing about what buyers thought is
// asking every visitor to be the first one.

const PANELS = path.join(__dirname, "panelStore.json");

/**
 * How many ratings a product needs before its panel carries one.
 *
 * Two five-star reviews average a perfect 5.0 and mean nothing; worse, "5.0
 * from 2 reviews" reads as a shop nobody buys from. Under the threshold the
 * panel says nothing at all, which is the honest state of it.
 */
const MIN_RATINGS = Number(process.env.RATING_MIN || 3);

/** The same product, whatever its apostrophes and emoji happen to be doing. */
const normalise = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Mean and count for one product, or null while there are too few to publish. */
function ratingFor(product) {
    if (!product) return null;

    const want = normalise(product);
    const scores = [];

    for (const [id, r] of Object.entries(load(STORE, {}))) {
        if (id.startsWith("__") || !r || !r.rating) continue;

        // The shop's own owner is not a customer. Testing the buttons with two
        // stars pulled a real 4.70 down to 4.45 on a live product panel, which
        // is the same trap /abandoned fell into with his own test checkouts.
        if (r.owner) continue;

        if (r.product === product || normalise(r.product) === want) scores.push(r.rating);
    }

    if (scores.length < MIN_RATINGS) return null;

    return {
        avg: scores.reduce((total, n) => total + n, 0) / scores.length,
        count: scores.length,
    };
}

/**
 * The line a product panel carries, or "" while the product is too new.
 *
 * Rounded stars beside the exact number: the stars are what the eye takes in at
 * a glance, and the number is there so that 4.7 is not quietly shown as five.
 */
function ratingLine(product) {
    const r = ratingFor(product);
    if (!r) return "";

    const stars = "\u2b50".repeat(Math.round(r.avg));
    const channel = process.env.VOUCH_CHANNEL_ID;

    return `${stars} **${r.avg.toFixed(1)}** / 5 \u2014 rated by ${r.count} customers`
        + (channel ? ` \u00b7 <#${channel}>` : "");
}

/**
 * Post a product panel, and remember it so its rating can stay current.
 *
 * The description is stored as it stood BEFORE the rating was appended. A later
 * refresh rebuilds from that, rather than trying to cut the old line back out of
 * the finished text -- which would be one greedy regex away from eating the price.
 */
async function postPanel(channel, { embed, components, files, product }) {
    const base = embed.data.description || "";
    const line = ratingLine(product);

    const shown = EmbedBuilder.from(embed)
        .setDescription(line ? `${base}\n\n${line}` : base);

    const payload = { embeds: [shown] };
    if (components) payload.components = components;
    if (files) payload.files = files;

    const message = await channel.send(payload);

    const panels = load(PANELS, {});
    panels[message.id] = { channel: message.channelId, product, base };
    fs.writeFileSync(PANELS, JSON.stringify(panels, null, 2));

    return message;
}

/**
 * Rewrite the rating on every posted panel for this product.
 *
 * Panels that have been deleted are forgotten rather than retried: the store
 * would otherwise accumulate dead ids for good, each one costing two failed API
 * calls every time anybody rates anything.
 */
async function refreshPanels(client, product) {
    if (!product) return;

    const panels = load(PANELS, {});
    const line = ratingLine(product);
    let forgot = false;

    for (const [id, panel] of Object.entries(panels)) {
        if (normalise(panel.product) !== normalise(product)) continue;

        try {
            const channel = await client.channels.fetch(panel.channel);
            const message = await channel.messages.fetch(id);
            if (!message.embeds[0]) continue;

            await message.edit({
                embeds: [EmbedBuilder.from(message.embeds[0])
                    .setDescription(line ? `${panel.base}\n\n${line}` : panel.base)],
            });
        } catch (err) {
            console.log(`[vouch] panel ${id} is gone (${err.message}) -- forgetting it`);
            delete panels[id];
            forgot = true;
        }
    }

    if (forgot) fs.writeFileSync(PANELS, JSON.stringify(panels, null, 2));
}

/**
 * The heading a panel prints, against the product name lava.top invoices under.
 *
 * Needed because the two are not the same string and never were: the panel says
 * "Membership" and the invoice says "Subscription ziplocker", which a review is
 * filed under as "Membership subscription".
 */
const PANEL_HEADINGS = [
    ["Muzzle Core FX", "Muzzle Core FX"],
    ["Ziplocker Summer Visuals", "Ziplocker Summer Visuals"],
    ["Complete Audio Overhaul", "Complete Audio Overhaul"],
    ["Ziplocker's Blood FX", "Ziplocker's Blood FX"],
    ["Ziplocker Graphics Pack", "Ziplocker Graphics Pack"],
    ["Ziplocker's Graphics Pack V2", "Ziplocker's Graphics Pack V2"],
    ["Ziplocker's Graphics V2", "Ziplocker's Graphics V2"],
    ["Basic", "Basic subscription"],
    ["Membership", "Membership subscription"],
    ["Premium", "Premium subscription"],
];

/** A rating line this code wrote earlier, so re-adopting cannot stack them up. */
const RATING_LINE = /\n*^\u2b50+ \*\*\d[^\n]*$/m;

/**
 * Register panels that were posted before any of this existed.
 *
 * The alternative was reposting every panel, which drops it to the bottom of the
 * shop channel and breaks every link anybody has ever pasted to it. This finds
 * the messages already there and adopts them in place.
 *
 * Matching is on the heading, normalised, so the emoji in front of it and the
 * apostrophe inside it do not matter. Anything that is not a known panel is left
 * alone -- there are announcements and images in these channels too.
 */
async function adoptPanels(channel) {
    const byHeading = new Map(PANEL_HEADINGS.map(([h, p]) => [normalise(h), p]));
    const panels = load(PANELS, {});
    const found = [];

    const messages = await channel.messages.fetch({ limit: 100 });

    for (const message of messages.values()) {
        if (!message.author.bot || !message.embeds[0]) continue;

        const description = message.embeds[0].description || "";
        const heading = description.split("\n").find((l) => l.startsWith("# "));
        if (!heading) continue;

        const product = byHeading.get(normalise(heading.slice(2)));
        if (!product) continue;

        // Store the panel as it reads WITHOUT a rating, so a second adopt of an
        // already-rated panel does not bake the old line into the base text.
        const base = description.replace(RATING_LINE, "");
        panels[message.id] = { channel: message.channelId, product, base };

        const line = ratingLine(product);
        await message.edit({
            embeds: [EmbedBuilder.from(message.embeds[0])
                .setDescription(line ? `${base}\n\n${line}` : base)],
        });

        found.push({ product, rated: Boolean(line) });
    }

    fs.writeFileSync(PANELS, JSON.stringify(panels, null, 2));
    return found;
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

    // Marked on the record rather than worked out at read time: the average is
    // computed synchronously, from the file alone, with no client to ask.
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        record.owner = String(guild.ownerId) === interaction.user.id;
    } catch {
        record.owner = false;
    }
    store[interaction.user.id] = record;
    save(store);

    // The average on the shop panels just moved. Every customer rating counts
    // towards it, including the low ones that never reach the channel.
    await refreshPanels(client, record.product);

    // Nothing else happens for the owner's own rating. Posting it would be the
    // shop reviewing itself, and there is no point DMing him what he just typed.
    if (record.owner) {
        return interaction.reply({
            content: "Noted, but not counted \u2014 your own rating stays out of the average "
                + "and out of the channel.",
            flags: 64,
        }).then(() => true);
    }

    /**
     * What somebody who rated low is answered with.
     *
     * The old wording said only that it had gone to the owner rather than the
     * channel, which reads uncomfortably close to "yours will not be shown" --
     * and it left the one person who has just said something is broken with
     * nowhere to go. A ticket is where it actually gets fixed, and a link button
     * is one tap instead of hunting for the channel.
     */
    const low = rating < PUBLIC_MIN;
    const ticket = process.env.TICKET_CHANNEL_ID;
    const guild = process.env.GUILD_ID;

    await interaction.reply({
        content: low
            ? "Thanks \u2014 that went straight to the owner rather than the channel.\n\n"
                + "If something isn't working, open a ticket and say what. It gets read."
            : "Thanks, it's up in the channel.",
        components: low && ticket && guild
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel("Open a ticket")
                    .setURL(`https://discord.com/channels/${guild}/${ticket}`))]
            : [],
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
    postPanel, refreshPanels, ratingLine, ratingFor, adoptPanels,
};
