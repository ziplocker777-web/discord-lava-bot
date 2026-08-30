/**
 * The admin commands that used to need an SSH session.
 *
 * Everything here answers a question that came up repeatedly while running the
 * shop by hand: who is this person, what did they buy, is their key alive, and
 * take it away. Doing that over SSH means being at a computer with a key on it;
 * doing it in Discord means doing it from a phone.
 *
 * All of them are Administrator-only and reply ephemerally, because every one
 * prints somebody's email address.
 */

const axios = require("axios");
const { getAllPurchases, getPurchaseForProduct, recordPurchase } = require("./purchaseStore");
const { getRolesForProduct, resolveTierWithLegacyFallback, tierDownloadsChannelId, TIERS } = require("./roles");
const { addRefund, removeRefund, isRefunded } = require("./refundedEmails");
const { deliverPurchase, buildDeliveryMessage } = require("./delivery");
const KNOWN_PRODUCT_IDS = require("./products");
const { MessageFlags } = require("discord.js");
const { search, setRevoked } = require("./watermarkStore");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

// The panel asks for a role by the name a person would say, not by the .env key.
const ROLE_ENV_BY_NAME = {
    buyer: "ROLE_ID",
    basic: "BASIC_ROLE_ID",
    membership: "SUBSCRIBE_ROLE_ID",
    premium: "PREMIUM_ROLE_ID",
};

// The four roles this bot hands out, so the rest of somebody's roles are not
// listed back at an admin who only wants to know what they bought.
const OUR_ROLE_IDS = () => [
    process.env.ROLE_ID,
    process.env.SUBSCRIBE_ROLE_ID,
    process.env.BASIC_ROLE_ID,
    process.env.PREMIUM_ROLE_ID,
].filter(Boolean);

const when = (t) => (t ? new Date(t).toISOString().replace("T", " ").slice(0, 16) : "—");

/**
 * The same handlers serve a slash command and a button panel, and the two carry
 * their arguments in different places -- options on one, modal fields on the
 * other. Asking both here means none of the handlers below has to care which
 * door the admin came through.
 */
function input(interaction, name) {
    if (typeof interaction.isChatInputCommand === "function" && interaction.isChatInputCommand()) {
        return interaction.options.getString(name) || "";
    }
    try {
        return interaction.fields.getTextInputValue(name) || "";
    } catch {
        return "";
    }
}

/**
 * Every invoice lava.top will hand over.
 *
 * Paged the same way in five places before this existed, which is four chances
 * for one of them to drift.
 */
/**
 * The shop owner's own Discord id, so their test checkouts can be left out of
 * anything that counts customers.
 *
 * Half the abandoned list was the owner testing the shop, which is the fastest
 * way to make a report nobody reads. Asked of Discord rather than configured,
 * because it is already the answer to "whose server is this".
 */
async function ownerId(client) {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        return String(guild.ownerId);
    } catch {
        return null;
    }
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

/** Every invoice lava.top holds for one buyer, whatever it was for. */
async function invoicesFor(query) {
    const rows = await allInvoices();
    const q = query.toLowerCase();
    return rows.filter((r) =>
        String(r.buyer?.email || "").toLowerCase() === q
        || String(r.clientUtm?.utm_content || "") === query);
}

/** The subscriptions among them, folded into one row each. */
function subscriptionsIn(mine) {
    const byId = new Map();
    for (const r of mine) {
        if (!r.subscriptionStatus) continue;
        const id = r.parentInvoice?.id || r.id;
        const e = byId.get(id) || { offer: null, status: null, expiredAt: null, terminatedAt: null };
        if (r.product?.offer) e.offer = r.product.offer;
        if (r.subscriptionStatus === "ACTIVE") e.status = "ACTIVE";
        else if (e.status !== "ACTIVE") e.status = r.subscriptionStatus;
        if (r.subscriptionDetails?.expiredAt) e.expiredAt = r.subscriptionDetails.expiredAt;
        if (r.subscriptionDetails?.terminatedAt) e.terminatedAt = r.subscriptionDetails.terminatedAt;
        byId.set(id, e);
    }
    return [...byId.values()];
}

/* ------------------------------------------------------------- /customer --- */

async function customer(interaction, client) {
    const query = input(interaction, "who").trim();
    const lines = [];

    const keys = search(query);
    const emails = [...new Set(keys.map((k) => k.email).filter(Boolean))];
    const ids = [...new Set(keys.map((k) => String(k.discordId)).filter(Boolean))];

    // A raw id or email that owns nothing still deserves an answer about roles.
    if (/^\d{17,20}$/.test(query) && !ids.includes(query)) ids.push(query);
    if (query.includes("@") && !emails.includes(query.toLowerCase())) emails.push(query.toLowerCase());

    if (emails.length === 0 && ids.length === 0) {
        return interaction.editReply("Nothing found for that.");
    }

    lines.push(`# ${emails.join(", ") || "no email on file"}`);
    if (ids.length) lines.push(ids.map((id) => `<@${id}>`).join(", "));

    // ---- what they bought
    const purchases = emails.flatMap((e) => getAllPurchases(e) || []);
    if (purchases.length) {
        lines.push("", "### Purchases");
        for (const p of purchases) {
            const status = p.status ? ` — ${p.status}` : "";
            lines.push(`• ${p.productTitle || p.productId} — ${when(p.timestamp)}${status}`);
        }
    }

    // ---- keys
    if (keys.length) {
        lines.push("", "### Licence keys");
        for (const k of keys) {
            const ips = [...new Set((k.activations || []).map((a) => a.ip).filter(Boolean))];
            lines.push(
                `• \`${k.licenseKey}\` — ${k.revoked ? "**REVOKED**" : "active"}` +
                ` — ${k.productTitle || "unknown"}`
            );
            lines.push(
                `  ${k.activationCount || 0} activation(s)` +
                (ips.length ? ` from ${ips.length} address(es)` : ", addresses not recorded") +
                (k.lastActivatedAt ? `, last ${when(k.lastActivatedAt)}` : "")
            );
            if (ips.length) lines.push(`  ${ips.join(", ")}`);
        }
    }

    // ---- what lava.top holds, which is the fuller answer
    //
    // The store only knows what a webhook told it, and for a stretch this
    // summer one of the two webhooks was misconfigured and its deliveries were
    // bounced -- so a real purchase can be missing from the store and present
    // here. Reading both sides is the only way to see that.
    try {
        const mine = await invoicesFor(emails[0] || query);
        const known = new Set(purchases.map((p) => p.productTitle));
        const bought = mine.filter((r) => String(r.status).toUpperCase() === "COMPLETED");

        if (bought.length) {
            lines.push("", "### On lava.top");
            for (const r of bought) {
                const title = r.product?.name || "?";
                const flag = known.has(title) ? "" : "  ⚠️ **not in the bot's records**";
                lines.push(
                    `• ${title} — ${r.receipt?.amount ?? "?"} ${r.receipt?.currency ?? ""}` +
                    ` — ${String(r.datetime || r.created).slice(0, 10)}${flag}`);
            }
        }

        const unpaid = mine.filter((r) => String(r.status).toUpperCase() !== "COMPLETED");
        if (unpaid.length) {
            lines.push(`_…and ${unpaid.length} checkout(s) that never completed._`);
        }

        const subs = subscriptionsIn(mine);
        if (subs.length) {
            lines.push("", "### Subscriptions");
            for (const s of subs) {
                const ends = s.terminatedAt
                    ? `ended ${when(s.terminatedAt)}`
                    : s.expiredAt
                        ? `paid until ${when(s.expiredAt)}`
                        : "no end date";
                lines.push(`• ${s.offer || "?"} — ${s.status} — ${ends}`);
            }
        }
    } catch (err) {
        lines.push("", `_lava.top did not answer (${err.response?.status || err.message})_`);
    }

    // ---- what Discord shows right now
    //
    // Names come off the roles themselves rather than a table in here: the
    // role called "buyer" in .env is called something else on the server, and
    // printing our name for it makes the answer wrong in a way nobody can see.
    const ours = OUR_ROLE_IDS();
    for (const id of ids) {
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch({ user: id, force: true });
            const held = member.roles.cache
                .filter((r) => ours.includes(r.id))
                .map((r) => r.name);
            lines.push("", `### Roles\n${held.join(", ") || "none of ours"}`);
        } catch {
            lines.push("", `**Roles** — <@${id}> is not on the server`);
        }
    }

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* --------------------------------------------------- /revokekey /restorekey */

async function setKeyState(interaction, revoked) {
    const query = input(interaction, "who").trim();
    const matches = search(query);

    if (matches.length === 0) {
        return interaction.editReply("No key found for that — try the key itself, an email, or a Discord id.");
    }

    // Refusing beats guessing: somebody with a subscription and a separate
    // purchase has two keys, and taking the wrong one back is worse than asking.
    if (matches.length > 1) {
        const list = matches
            .map((k) => `• \`${k.licenseKey}\` — ${k.productTitle || "unknown"}${k.revoked ? " (already revoked)" : ""}`)
            .join("\n");
        return interaction.editReply(`That matches ${matches.length} keys — run it again with the exact key:\n${list}`);
    }

    const key = matches[0];
    if (Boolean(key.revoked) === revoked) {
        return interaction.editReply(
            `\`${key.licenseKey}\` is already ${revoked ? "revoked" : "active"}. Nothing changed.`);
    }

    setRevoked(key.licenseKey, revoked);

    return interaction.editReply(
        `${revoked ? "🔒 Revoked" : "🔓 Restored"} \`${key.licenseKey}\` — ${key.productTitle || "unknown"}` +
        ` (${key.email || "no email"})\n` +
        (revoked
            ? "Their app drops back to the key screen next time it starts with a connection."
            : "It will unlock again on their next start.")
    );
}

/* --------------------------------------------------------------- /lapsed --- */

async function lapsed(interaction) {
    const subs = [];
    let rows;
    try {
        rows = await allInvoices();
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const byId = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const id = r.parentInvoice?.id || r.id;
        const e = byId.get(id) || { email: null, status: null, expiredAt: null, terminatedAt: null, offer: null };
        if (r.buyer?.email) e.email = r.buyer.email;
        if (r.product?.offer) e.offer = r.product.offer;
        if (r.subscriptionStatus === "ACTIVE") e.status = "ACTIVE";
        else if (e.status !== "ACTIVE") e.status = r.subscriptionStatus;
        if (r.subscriptionDetails?.expiredAt) e.expiredAt = r.subscriptionDetails.expiredAt;
        if (r.subscriptionDetails?.terminatedAt) e.terminatedAt = r.subscriptionDetails.terminatedAt;
        byId.set(id, e);
    }

    const now = Date.now();
    for (const s of byId.values()) {
        const over = s.expiredAt ? Date.parse(s.expiredAt) < now : s.status === "FAILED";
        subs.push({ ...s, over });
    }

    const running = subs.filter((s) => !s.over);
    const ending = subs
        .filter((s) => !s.over && s.expiredAt)
        .sort((a, b) => Date.parse(a.expiredAt) - Date.parse(b.expiredAt));

    const lines = [
        `**${running.length} subscription(s) running**, ${subs.length - running.length} over.`,
    ];

    if (ending.length) {
        lines.push("", "### Cancelled, still paid for");
        for (const s of ending) {
            lines.push(`• ${s.email} — ${s.offer} — until ${when(s.expiredAt)}`);
        }
    }

    lines.push("", "_The nightly sweep takes the role when the paid period is over, and the key three days after that._");

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* ------------------------------------------------------------ /grantrole --- */

/**
 * Hand somebody a role by hand.
 *
 * For the purchase that arrived without a Discord id, or the one that came
 * through some route the bot never saw. Recorded under a "manual-" contract so
 * the nightly sweep leaves it alone for ever: there is no upstream subscription
 * to go dead, so nothing should ever decide it has.
 */
async function grantrole(interaction, client) {
    // A slash command can offer a real user picker; a modal can only take text,
    // so the panel asks for an id instead. Both end up as an id here.
    const picked = typeof interaction.options?.getUser === "function"
        ? interaction.options.getUser("user")
        : null;
    const userId = picked ? picked.id : input(interaction, "user").replace(/[<@!>]/g, "").trim();

    const asked = (input(interaction, "role") || "").trim();
    const roleEnv = ROLE_ENV_BY_NAME[asked.toLowerCase()] || asked;
    const email = input(interaction, "email").trim().toLowerCase();

    if (!/^\d{17,20}$/.test(userId)) {
        return interaction.editReply(`\`${userId || "(empty)"}\` is not a Discord id.`);
    }

    const roleId = process.env[roleEnv];
    if (!roleId) {
        return interaction.editReply(
            `Don't know a role called \`${asked}\`. Use one of: buyer, Basic, Membership, Premium.`);
    }

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch({ user: userId, force: true });

    if (member.roles.cache.has(roleId)) {
        return interaction.editReply(`<@${userId}> already has that role.`);
    }

    await member.roles.add(roleId);

    let note = "";
    if (email) {
        recordPurchase(email, {
            productId: null,
            productTitle: `Granted by hand (${roleEnv})`,
            contractId: `manual-${Date.now()}`,
            discordId: userId,
            status: "manual",
        });
        note = `\nRecorded against \`${email}\` — the nightly sweep will never take it back.`;
    }

    return interaction.editReply(`✅ Gave <@${userId}> the **${asked || roleEnv}** role.${note}`);
}

/* ---------------------------------------------------------------- /refund --- */

/**
 * Undo a sale the seller refunded.
 *
 * The same three things the webhook does, for a refund issued somewhere the
 * webhook did not see: the role, the key, and the block on claiming it again.
 */
async function refund(interaction, client) {
    const email = input(interaction, "email").trim().toLowerCase();
    const title = input(interaction, "product");

    const purchases = getAllPurchases(email) || [];
    if (purchases.length === 0) {
        // It said it was blocking the email and then did not. Somebody refunded
        // on lava.top for a purchase this bot never recorded is exactly when the
        // block matters, so now it actually happens.
        addRefund(email);
        return interaction.editReply(
            `No purchase on file for \`${email}\`, so there was no role or key to take.\n` +
            `• blocked from /getrole and the redownload panel\n\n` +
            `\`/unrefund\` undoes this.`);
    }

    let purchase;
    if (title) {
        // The slash command offers a list to pick from; the panel's form is a
        // plain text box, so the name arrives however it was typed.
        const wanted = title.trim().toLowerCase();
        const match = Object.keys(KNOWN_PRODUCT_IDS)
            .find((name) => name.toLowerCase() === wanted)
            || Object.keys(KNOWN_PRODUCT_IDS).find((name) => name.toLowerCase().includes(wanted));

        if (!match) {
            return interaction.editReply(
                `Don't know a product called **${title}**. One of:\n` +
                Object.keys(KNOWN_PRODUCT_IDS).map((n) => `• ${n}`).join("\n"));
        }

        purchase = getPurchaseForProduct(email, KNOWN_PRODUCT_IDS[match]);
        if (!purchase) return interaction.editReply(`\`${email}\` has no purchase of **${match}**.`);
    } else if (purchases.length > 1) {
        const list = purchases.map((p) => `• ${p.productTitle || p.productId}`).join("\n");
        return interaction.editReply(
            `\`${email}\` owns ${purchases.length} things — say which one:\n${list}`);
    } else {
        purchase = purchases[0];
    }

    const did = [];

    addRefund(email);
    did.push("blocked from /getrole and the redownload panel");

    recordPurchase(email, { ...purchase, status: "refunded", refundedAt: Date.now() });

    const keys = search(email).filter((k) => k.productId === purchase.productId);
    for (const k of keys) {
        if (k.revoked) continue;
        setRevoked(k.licenseKey, true);
        did.push(`key \`${k.licenseKey}\` revoked`);
    }

    if (purchase.discordId) {
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch({ user: purchase.discordId, force: true });
            for (const roleId of getRolesForProduct(purchase.productId)) {
                if (!member.roles.cache.has(roleId)) continue;
                await member.roles.remove(roleId);
                did.push("role removed");
            }
        } catch (err) {
            did.push(`⚠️ role not removed: ${err.message}`);
        }
    } else {
        did.push("⚠️ no Discord id on the purchase — no role removed");
    }

    return interaction.editReply(
        `**Refunded** ${purchase.productTitle || purchase.productId} for \`${email}\`\n` +
        did.map((d) => `• ${d}`).join("\n"));
}

/* --------------------------------------------------------------- /deliver --- */

/**
 * Give somebody a product they did not buy.
 *
 * A tester, a giveaway, a purchase that happened somewhere this bot never saw.
 * The same three steps a real sale takes -- record it, grant the role, send the
 * link and the key -- so from that point on the person is indistinguishable from
 * a buyer and every other command works on them.
 *
 * Recorded under a "manual-" contract, which is what stops the nightly sweep
 * ever taking it back: there is no subscription upstream that could go dead.
 */
async function deliver(interaction, client) {
    const userId = input(interaction, "user").replace(/[<@!>]/g, "").trim();
    const email = input(interaction, "email").trim().toLowerCase();
    const asked = input(interaction, "product").trim();

    if (!/^\d{17,20}$/.test(userId)) {
        return interaction.editReply(`\`${userId || "(empty)"}\` is not a Discord id.`);
    }
    if (!email.includes("@")) {
        return interaction.editReply("Needs an email — it is the key the whole record is filed under.");
    }

    const wanted = asked.toLowerCase();
    const title = Object.keys(KNOWN_PRODUCT_IDS).find((n) => n.toLowerCase() === wanted)
        || Object.keys(KNOWN_PRODUCT_IDS).find((n) => n.toLowerCase().includes(wanted));

    if (!title) {
        return interaction.editReply(
            `Don't know a product called **${asked}**. One of:\n` +
            Object.keys(KNOWN_PRODUCT_IDS).map((n) => `• ${n}`).join("\n"));
    }

    const productId = KNOWN_PRODUCT_IDS[title];
    const { WATERMARKED_PRODUCT_IDS } = require("./webhookServer");

    // The download route serves one package. Anything else has no file behind
    // its key, so sending a link would hand them the configurator by mistake.
    if (!WATERMARKED_PRODUCT_IDS.has(productId)) {
        return interaction.editReply(
            `**${title}** is not delivered by this bot — there is no package behind it.\n` +
            `Use \`/grantrole\` for the role and send the files the way you normally do.`);
    }

    recordPurchase(email, {
        productId,
        productTitle: title,
        discordId: userId,
        contractId: `manual-${Date.now()}`,
    });

    const done = [`recorded against \`${email}\``];

    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch({ user: userId, force: true });
        for (const roleId of getRolesForProduct(productId)) {
            if (member.roles.cache.has(roleId)) continue;
            await member.roles.add(roleId);
            done.push("role granted");
        }
    } catch (err) {
        done.push(`⚠️ role not granted: ${err.message}`);
    }

    let delivery;
    try {
        delivery = deliverPurchase({ email, discordId: userId, productId, productTitle: title });
    } catch (err) {
        return interaction.editReply(`Recorded, but the download could not be built: ${err.message}`);
    }

    done.push(delivery.isNew ? "new key issued" : "they already had a key — reusing it");

    const message = buildDeliveryMessage({
        productId,
        productTitle: title,
        downloadUrl: delivery.downloadUrl,
        licenseKey: delivery.licenseKey,
        tierLabel: resolveTierWithLegacyFallback({ productId })?.label,
        downloadsChannelId: tierDownloadsChannelId(null),
        greeting: "Here is your access.",
    });

    try {
        const user = await client.users.fetch(userId);
        await user.send(message);
        return interaction.editReply(
            `✅ Sent <@${userId}> **${title}**\n` + done.map((d) => `• ${d}`).join("\n") +
            `\n\nKey: \`${delivery.licenseKey}\``);
    } catch (err) {
        return interaction.editReply(
            `Everything is set up, but the DM failed (${err.message}) — their DMs are shut.\n` +
            done.map((d) => `• ${d}`).join("\n") +
            `\n\nSend this on yourself:\nDownload: ${delivery.downloadUrl}\n` +
            `License key: \`${delivery.licenseKey}\``);
    }
}

/* ---------------------------------------------------------------- /resend --- */

/**
 * Send somebody their download again.
 *
 * The same link and the same key, not new ones: deliverPurchase hands back what
 * already exists. For the buyer whose DMs were closed at the moment of purchase,
 * which is the one failure that leaves somebody having paid for nothing.
 */
async function resend(interaction, client) {
    const query = input(interaction, "who").trim();

    const keys = search(query);
    if (keys.length === 0) {
        return interaction.editReply("Nothing found — try an email, a Discord id, or the key itself.");
    }
    if (keys.length > 1) {
        const list = keys.map((k) => `• \`${k.licenseKey}\` — ${k.productTitle}`).join("\n");
        return interaction.editReply(`That matches ${keys.length} purchases — run it again with the exact key:\n${list}`);
    }

    const record = keys[0];

    // The download route serves one package -- the configurator -- whatever the
    // token belongs to. Resending a product that is not that package would hand
    // somebody the wrong file entirely, so it refuses rather than guesses.
    const { WATERMARKED_PRODUCT_IDS } = require("./webhookServer");
    if (!WATERMARKED_PRODUCT_IDS.has(record.productId)) {
        return interaction.editReply(
            `**${record.productTitle}** is not delivered by this bot — there is no package behind its key, ` +
            `so resending would send them the configurator by mistake.

` +
            `Their key is \`${record.licenseKey}\`. Send the files the way you normally do.`);
    }

    let delivery;
    try {
        delivery = deliverPurchase({
            email: record.email,
            discordId: record.discordId,
            productId: record.productId,
            productTitle: record.productTitle,
        });
    } catch (err) {
        return interaction.editReply(`Could not build the download: ${err.message}`);
    }

    const purchase = getPurchaseForProduct(record.email, record.productId);
    const tier = resolveTierWithLegacyFallback(purchase || {});

    const message = buildDeliveryMessage({
        productId: record.productId,
        productTitle: record.productTitle,
        downloadUrl: delivery.downloadUrl,
        licenseKey: delivery.licenseKey,
        tierLabel: tier?.label,
        downloadsChannelId: tierDownloadsChannelId(tier),
        greeting: "Here is your download again.",
    });

    try {
        const user = await client.users.fetch(record.discordId);
        await user.send(message);
        return interaction.editReply(
            `✅ Sent <@${record.discordId}> their **${record.productTitle}** download again.`);
    } catch (err) {
        // Their DMs are shut, which is very likely why this command was needed.
        // Hand it to the admin so it can go out some other way.
        return interaction.editReply(
            `Could not DM <@${record.discordId}> (${err.message}). Send this on yourself:\n\n` +
            `Download: ${delivery.downloadUrl}\nLicense key: \`${delivery.licenseKey}\``);
    }
}

/* ----------------------------------------------------------------- /stats --- */

async function stats(interaction) {
    let rows;
    try {
        rows = await allInvoices();
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const now = Date.now();
    const paid = rows.filter((r) => String(r.status).toUpperCase() === "COMPLETED");

    const within = (hours) => paid.filter((r) => {
        const t = Date.parse(r.datetime || r.created || "");
        return Number.isFinite(t) && now - t < hours * 3600e3;
    });

    /**
     * What actually arrives, not what the buyer paid.
     *
     * lava.top takes a commission on every sale -- eight per cent, on all 156 of
     * them -- and it is in the invoice as `fee`. Reporting the gross overstates
     * takings by that much, which is exactly the kind of number that stops
     * matching the bank and makes the whole panel untrustworthy.
     *
     * Refunds are subtracted from our own list because lava.top does not mark
     * them: a refunded sale still reads COMPLETED in the API for ever, so the
     * only record that it happened is the one this bot keeps.
     */
    const refundedList = (() => {
        try { return require("./refundedEmails.json"); } catch { return []; }
    })();

    const net = (list) => {
        const sums = {};
        for (const r of list) {
            const email = String(r.buyer?.email || "").toLowerCase();
            if (refundedList.includes(email)) continue;
            const cur = r.receipt?.currency || r.amountTotal?.currency || "?";
            const amount = r.receipt?.amount ?? r.amountTotal?.amount ?? 0;
            sums[cur] = (sums[cur] || 0) + amount - (r.receipt?.fee || 0);
        }
        return Object.entries(sums).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(", ") || "—";
    };

    const gross = (list) => {
        const sums = {};
        for (const r of list) {
            const cur = r.receipt?.currency || r.amountTotal?.currency || "?";
            sums[cur] = (sums[cur] || 0) + (r.receipt?.amount ?? r.amountTotal?.amount ?? 0);
        }
        return Object.entries(sums).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(", ") || "—";
    };

    const day = within(24);
    const week = within(24 * 7);
    const month = within(24 * 30);

    // Subscriptions that are genuinely still running: cancelled ones keep the
    // ACTIVE label until the period they paid for is over.
    const subs = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const id = r.parentInvoice?.id || r.id;
        const e = subs.get(id) || { status: null, expiredAt: null, offer: null };
        if (r.product?.offer) e.offer = r.product.offer;
        if (r.subscriptionStatus === "ACTIVE") e.status = "ACTIVE";
        else if (e.status !== "ACTIVE") e.status = r.subscriptionStatus;
        if (r.subscriptionDetails?.expiredAt) e.expiredAt = r.subscriptionDetails.expiredAt;
        subs.set(id, e);
    }
    const live = [...subs.values()].filter((sv) =>
        sv.expiredAt ? Date.parse(sv.expiredAt) > now : sv.status === "ACTIVE");

    const sellers = {};
    for (const r of week) {
        const name = r.product?.name || "?";
        sellers[name] = (sellers[name] || 0) + 1;
    }
    const top = Object.entries(sellers).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, n]) => `• ${name} — ${n}`).join("\n");

    // All time is only as long as lava.top's invoice list reaches back, so it is
    // labelled by the date of the earliest one rather than called "all time".
    const oldest = paid
        .map((r) => Date.parse(r.datetime || r.created || ""))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)[0];

    // Summed from each subscription's own tier rather than one assumed price:
    // Membership and Premium are different money, and Membership itself exists
    // at two prices because the old subscribers kept theirs.
    const recurring = live.reduce((total, sv) => {
        const tier = TIERS.find((t) => t.label.toLowerCase() === String(sv.offer || "").toLowerCase());
        return total + (tier?.prices?.USD || 0);
    }, 0);

    const refundedHere = paid.filter((r) =>
        refundedList.includes(String(r.buyer?.email || "").toLowerCase())).length;

    return interaction.editReply([
        "# Sales",
        "### Taken, after commission",
        `• 24 hours — ${day.length} sale(s), ${net(day)}`,
        `• 7 days — ${week.length} sale(s), ${net(week)}`,
        `• 30 days — ${month.length} sale(s), ${net(month)}`,
        `• since ${oldest ? when(oldest).slice(0, 10) : "the start"} — ${paid.length} sale(s), **${net(paid)}**`,
        "",
        `_Gross was ${gross(paid)}; lava.top's cut and ${refundedHere} known refund(s) are already off._`,
        "",
        `### Subscriptions\n${live.length} running` +
        (recurring ? ` — ${recurring.toFixed(2)} USD a month before commission` : ""),
        "",
        top ? `### This week\n${top}` : "_No sales this week._",
    ].join("\n").slice(0, 1990));
}

/* -------------------------------------------------------------- /unrefund --- */

/**
 * Undo a refund.
 *
 * /refund is one command and one typo away from locking out a paying customer,
 * and the block it sets is on the whole email rather than one product. Something
 * that destructive needs a way back that does not involve an SSH session.
 */
async function unrefund(interaction, client) {
    const email = input(interaction, "email").trim().toLowerCase();
    const did = [];

    if (removeRefund(email)) did.push("taken off the refund list");

    for (const k of search(email)) {
        if (!k.revoked) continue;
        setRevoked(k.licenseKey, false);
        did.push(`key \`${k.licenseKey}\` restored`);
    }

    // Saying "undone" when nothing was undone is how a panel stops being
    // trusted -- the same fault /refund had an hour ago.
    if (did.length === 0) {
        return interaction.editReply(
            `\`${email}\` was not blocked and has no revoked key. Nothing to undo.`);
    }

    return interaction.editReply(
        `**Refund undone** for \`${email}\`\n` + did.map((d) => `• ${d}`).join("\n") +
        `\n\nRoles are not put back automatically — use \`/grantrole\` if they need one.`);
}

/* --------------------------------------------------------------- /pending --- */

/**
 * Bought, and never activated.
 *
 * Everyone here paid and then, as far as the app is concerned, never got in.
 * Some are sitting on an unopened download; some could not install it and
 * quietly went away. Nothing else in the system surfaces them, and they are the
 * cheapest customers to save because they have already paid.
 */
async function pending(interaction) {
    const now = Date.now();
    // Read straight from the store: search() answers about one person, and this
    // question is about everybody.
    const store = require("./watermarkStore.json");
    const { WATERMARKED_PRODUCT_IDS } = require("./webhookServer");

    // Only the products that carry the configurator can be "not activated".
    // Flash Collection is a folder of presets that drops into an install that is
    // already working -- it has a key because every download gets one, but there
    // is no app to type it into, so it would sit in this list for ever.
    const stale = Object.values(store)
        .filter((k) => WATERMARKED_PRODUCT_IDS.has(k.productId))
        .filter((k) => !k.activationCount && k.createdAt && now - k.createdAt > 24 * 3600e3)
        .sort((a, b) => a.createdAt - b.createdAt);

    if (stale.length === 0) {
        return interaction.editReply("Everybody who bought more than a day ago has activated.");
    }

    const lines = [`# ${stale.length} never activated`, ""];
    for (const k of stale.slice(0, 20)) {
        const days = ((now - k.createdAt) / 86400e3).toFixed(0);
        lines.push(
            `• ${k.email || "no email"} — ${k.productTitle || "unknown"} — ${days}d ago` +
            (k.downloaded ? "" : " — **never even downloaded**"));
    }
    if (stale.length > 20) lines.push(`… and ${stale.length - 20} more`);
    lines.push("", "_`/resend` sends them their link and key again._");

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* ----------------------------------------------------------------- /sync --- */

/**
 * Put back a role that should be there.
 *
 * Grants only. Taking a role away is the nightly sweep's job, and it has
 * safeguards this does not -- the paid-until date, the exempt list, the check
 * for a second live subscription. A repair tool that could also revoke would be
 * a way to lose all of that in one command.
 */
async function sync(interaction, client) {
    const email = input(interaction, "email").trim().toLowerCase();

    let subs;
    try {
        subs = subscriptionsIn(await invoicesFor(email));
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const now = Date.now();
    const live = subs.filter((sv) =>
        sv.expiredAt ? Date.parse(sv.expiredAt) > now : sv.status === "ACTIVE");

    if (live.length === 0) {
        return interaction.editReply(
            `\`${email}\` has no running subscription on lava.top — nothing to put back.` +
            (subs.length ? `\nFound ${subs.length} that have ended.` : ""));
    }

    const purchases = getAllPurchases(email) || [];
    const discordId = purchases.find((p) => p.discordId)?.discordId;
    if (!discordId) {
        return interaction.editReply(
            `\`${email}\` has a running subscription but no Discord id on file — ` +
            `use \`/grantrole\` once you know who they are.`);
    }

    if (isRefunded(email)) {
        return interaction.editReply(
            `\`${email}\` is on the refund list. Clear it with \`/unrefund\` first if that is wrong.`);
    }

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch({ user: discordId, force: true });

    const given = [];
    for (const sv of live) {
        const tier = TIERS.find((t) => t.label.toLowerCase() === String(sv.offer || "").toLowerCase());
        const roleId = tier && process.env[tier.roleEnv];
        if (!roleId) continue;
        if (member.roles.cache.has(roleId)) continue;
        await member.roles.add(roleId);
        given.push(tier.label);
    }

    const buyerRole = process.env.ROLE_ID;
    if (buyerRole && !member.roles.cache.has(buyerRole)) {
        await member.roles.add(buyerRole);
        given.push("buyer");
    }

    return interaction.editReply(given.length
        ? `✅ Gave <@${discordId}> back: **${given.join(", ")}**`
        : `<@${discordId}> already has everything their subscription entitles them to.`);
}

/* --------------------------------------------------------------- /health --- */

async function health(interaction) {
    const { execSync } = require("child_process");
    const store = require("./watermarkStore.json");
    const lines = [];

    const up = process.uptime();
    const hrs = Math.floor(up / 3600);
    const mins = Math.floor((up % 3600) / 60);
    lines.push("# Health", "", `**Bot** — up ${hrs}h ${mins}m`);

    let lava_ok = false;
    try {
        await lava.get("/invoices", { params: { page: 0, size: 1 } });
        lava_ok = true;
    } catch { /* reported below */ }
    lines.push(`**lava.top** — ${lava_ok ? "answering" : "**not answering**"}`);

    try {
        const cron = execSync("crontab -l 2>/dev/null | grep -c revoke-lapsed").toString().trim();
        lines.push(`**Nightly sweep** — ${cron === "0" ? "**not scheduled**" : "scheduled, 04:00"}`);
    } catch {
        lines.push("**Nightly sweep** — could not read crontab");
    }

    try {
        const last = execSync("tail -3 /root/discord-lava-bot/revoke-cron.log 2>/dev/null").toString().trim();
        lines.push(last ? `\`\`\`
${last.slice(-400)}
\`\`\`` : "_The sweep has not written a log yet — first run is tonight._");
    } catch {
        lines.push("_No sweep log yet._");
    }

    const keys = Object.values(store);
    lines.push(
        "",
        `**Keys** — ${keys.length} issued, ${keys.filter((k) => k.revoked).length} revoked, ` +
        `${keys.filter((k) => !k.activationCount).length} never activated`
    );

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* ------------------------------------------------------------------------- */

/* ------------------------------------------------------------ /abandoned --- */

/**
 * People who started paying and did not finish.
 *
 * Thirty-five of these sit in lava.top and thirty-four carry the Discord id of
 * somebody already on the server -- so unlike almost any other lost sale, these
 * can be asked about.
 *
 * The filtering is the whole job. A checkout that failed and was retried
 * successfully leaves the failed attempt behind for ever, so the raw list has
 * paying subscribers in it. Anyone who later bought the same product is not an
 * abandoned sale, and a card that simply declined is not a change of mind.
 */
async function abandoned(interaction, client) {
    const mine = client ? await ownerId(client) : null;
    let rows;
    try {
        rows = await allInvoices();
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const done = new Set();
    for (const r of rows) {
        if (String(r.status).toUpperCase() !== "COMPLETED") continue;
        done.add(`${String(r.buyer?.email || "").toLowerCase()}|${r.product?.name || ""}`);
    }

    const seen = new Set();
    const lost = [];

    for (const r of rows) {
        const status = String(r.status).toUpperCase();
        if (status === "COMPLETED" || status === "FAILED") continue;

        // Your own test checkouts are not lost sales.
        if (mine && String(r.clientUtm?.utm_content || "") === mine) continue;

        const email = String(r.buyer?.email || "").toLowerCase();
        const product = r.product?.name || "?";
        const key = `${email}|${product}`;

        if (done.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);

        lost.push({
            email,
            product,
            amount: r.receipt?.amount ?? r.amountTotal?.amount ?? 0,
            currency: r.receipt?.currency ?? "",
            at: r.datetime || r.created,
            discordId: r.clientUtm?.utm_content || null,
        });
    }

    if (lost.length === 0) {
        return interaction.editReply("Nobody has an unfinished checkout they did not come back to.");
    }

    lost.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const total = lost.reduce((t, l) => t + l.amount, 0);

    const lines = [
        `# ${lost.length} unfinished checkouts`,
        `_${total.toFixed(2)} USD that never arrived._`,
        "",
    ];

    for (const l of lost.slice(0, 12)) {
        lines.push(
            `• ${String(l.at).slice(0, 10)} — ${l.product} — ${l.amount} ${l.currency}`);
        lines.push(`  ${l.discordId ? `<@${l.discordId}>` : "no Discord id"} · ${l.email}`);
    }
    if (lost.length > 12) lines.push(`… and ${lost.length - 12} more`);

    lines.push("", "_Retries that later went through are already excluded._");

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* ------------------------------------------------------------------ /top --- */

/** Who spends the most, and how many of them come back. */
async function top(interaction, client) {
    const mine = client ? await ownerId(client) : null;
    let rows;
    try {
        rows = await allInvoices();
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const refundedList = (() => {
        try { return require("./refundedEmails.json"); } catch { return []; }
    })();

    const by = new Map();
    for (const r of rows) {
        if (String(r.status).toUpperCase() !== "COMPLETED") continue;
        if (mine && String(r.clientUtm?.utm_content || "") === mine) continue;

        const email = String(r.buyer?.email || "").toLowerCase();
        if (!email || refundedList.includes(email)) continue;

        const e = by.get(email) || { n: 0, spent: 0, id: null, last: "" };
        e.n += 1;
        // Net, to match /stats: the commission never reached you either.
        e.spent += (r.receipt?.amount || 0) - (r.receipt?.fee || 0);
        if (r.clientUtm?.utm_content) e.id = String(r.clientUtm.utm_content);
        const at = String(r.datetime || r.created || "");
        if (at > e.last) e.last = at;
        by.set(email, e);
    }

    const ranked = [...by.entries()].sort((a, b) => b[1].spent - a[1].spent);
    const repeat = ranked.filter(([, v]) => v.n > 1).length;

    const lines = [`# ${by.size} buyers`, `_${repeat} of them have come back._`, ""];

    ranked.slice(0, 12).forEach(([email, v], i) => {
        lines.push(`**${i + 1}.** ${v.spent.toFixed(2)} USD — ${v.n} purchase(s)`);
        lines.push(`  ${v.id ? `<@${v.id}>` : email} · last ${v.last.slice(0, 10)}`);
    });

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* ---------------------------------------------------------------- /vouch --- */

/**
 * Who would be asked to rate what they bought, and what has come back so far.
 *
 * Read-only, for the same reason /winback is: this messages real customers, so
 * the list and the wording are worth looking at before either goes anywhere.
 */
/** Put the rating panel at the bottom of the vouch channel. */
async function vouchpanel(interaction, client) {
    const { movePanel } = require("./vouch");

    if (!process.env.VOUCH_CHANNEL_ID) {
        return interaction.editReply("`VOUCH_CHANNEL_ID` is not set in .env.");
    }

    try {
        await movePanel(client);
        return interaction.editReply(
            `✅ Posted in <#${process.env.VOUCH_CHANNEL_ID}>.\n` +
            "It moves itself back to the bottom after every review, so it never gets buried.");
    } catch (err) {
        return interaction.editReply(`Could not post it: ${err.message}`);
    }
}

async function vouch(interaction, client) {
    const v = require("./vouch");

    let people;
    try {
        people = await v.candidates(client);
    } catch (err) {
        return interaction.editReply(`Could not work out who to ask: ${err.message}`);
    }

    // The panel's own message id lives in the same file; it is not a person.
    const asked = Object.fromEntries(
        Object.entries(v.load(v.STORE, {})).filter(([k]) => !k.startsWith("__")));
    const rated = Object.values(asked).filter((a) => a.rating);
    const average = rated.length
        ? (rated.reduce((t, a) => t + a.rating, 0) / rated.length).toFixed(2)
        : null;

    const on = process.env.VOUCH === "on";
    const perSweep = process.env.VOUCH_PER_SWEEP || 5;

    const lines = [
        on
            ? `**Asking is on** — ${perSweep} an hour.`
            : "**Asking is off.** Put `VOUCH=on` in .env and restart to turn it on.",
        "",
        `**${people.length} could be asked** — everyone who activated over ` +
        `${process.env.VOUCH_AFTER_DAYS || 3} days ago and has not been asked.`,
    ];

    for (const p of people.slice(0, 6)) {
        lines.push(`• <@${p.discordId}> — ${p.product}`);
    }
    if (people.length > 6) lines.push(`… and ${people.length - 6} more`);

    lines.push(
        "",
        `**Replies** — ${rated.length} of ${Object.keys(asked).length} asked` +
        (average ? `, averaging **${average}★**` : ""));

    for (const [id, a] of Object.entries(asked).filter(([, a]) => a.rating).slice(-4)) {
        lines.push(`• ${"⭐".repeat(a.rating)} <@${id}> — ${(a.words || "no words").slice(0, 80)}`);
    }

    lines.push(
        "",
        "**They get one message, once, ever:**",
        "> You've been using **<product>** for a few days now — how's it going?",
        "> If you've got five seconds, a rating would genuinely help.",
        "",
        `_Five buttons, then an optional box for words. ${process.env.VOUCH_PUBLIC_MIN || 4}★ and up ` +
        "go to the vouch channel; anything lower comes to you instead._");

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* --------------------------------------------------------------- /members --- */

/**
 * Join dates, read out of the welcome channel.
 *
 * The bot cannot list the server's members: that needs the Server Members
 * intent, which is off. But Carl-bot has been posting "Welcome, @someone" in
 * the joins channel since June, each one carrying the id and dated by the
 * message itself, which is the same information arriving by another road.
 *
 * Fourteen pages of history per call, so the result is held for an hour. Nobody
 * needs this to the minute.
 */
let joinCache = { at: 0, rows: [] };

async function joinLog(client) {
    if (Date.now() - joinCache.at < 60 * 60 * 1000) return joinCache.rows;

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channels = await guild.channels.fetch();
    const channel = [...channels.values()].find((c) => c && /joins/i.test(c.name));
    if (!channel) return [];

    const rows = [];
    let before;
    for (let page = 0; page < 25; page += 1) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (!batch.size) break;
        for (const m of batch.values()) {
            const id = String(m.content || "").match(/<@!?(\d+)>/)?.[1];
            if (id) rows.push({ id, at: m.createdTimestamp });
            before = m.id;
        }
        if (batch.size < 100) break;
    }

    joinCache = { at: Date.now(), rows };
    return rows;
}

/**
 * Which of the people who bought are still here.
 *
 * Checked one at a time, which is only affordable because there are sixty-odd
 * of them; the eleven hundred who merely joined are counted by subtraction
 * instead. Held with the join log, because a member fetch each is the slow part
 * of this command.
 */
let goneCache = { at: 0, gone: [] };

async function buyersWhoLeft(client, buyers) {
    if (Date.now() - goneCache.at < 60 * 60 * 1000) return goneCache.gone;

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const gone = [];

    for (const id of buyers) {
        try {
            await guild.members.fetch({ user: id, force: false });
        } catch {
            gone.push(id);   // not on the server any more
        }
    }

    goneCache = { at: Date.now(), gone };
    return gone;
}

/** A day-by-day bar, scaled to its own busiest day. */
function chart(rows, days) {
    const now = Date.now();
    const buckets = new Map();

    for (let d = 0; d < days; d += 1) {
        const day = new Date(now - d * 86400e3).toISOString().slice(0, 10);
        buckets.set(day, 0);
    }
    for (const r of rows) {
        const day = new Date(r.at).toISOString().slice(0, 10);
        if (buckets.has(day)) buckets.set(day, buckets.get(day) + 1);
    }

    const entries = [...buckets.entries()].reverse();
    const peak = Math.max(...entries.map(([, n]) => n), 1);

    return entries.map(([day, n]) => {
        const width = Math.round((n / peak) * 18);
        const label = day.slice(5).replace("-", ".");
        return `\u0060${label}\u0060 ${"\u2588".repeat(width) || "\u00b7"} ${n}`;
    });
}

async function members(interaction, client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);

    let rows;
    try {
        rows = await joinLog(client);
    } catch (err) {
        return interaction.editReply(`Could not read the joins channel: ${err.message}`);
    }

    if (rows.length === 0) {
        return interaction.editReply(
            "No join log to read. This counts the welcome messages in the joins " +
            "channel, so it needs one that the bot can see.");
    }

    const now = Date.now();
    const since = (hours) => rows.filter((r) => now - r.at < hours * 3600e3).length;

    // First arrival per person: somebody who left and came back has heard of the
    // shop once, not twice.
    const first = new Map();
    for (const r of rows) {
        const prev = first.get(r.id);
        if (!prev || r.at < prev) first.set(r.id, r.at);
    }

    const oldest = Math.min(...rows.map((r) => r.at));

    // Anyone ever issued a key has bought something.
    const marks = Object.values(require("./watermarkStore.json"));
    const buyers = new Map();
    for (const m of marks) {
        const id = String(m.discordId || "");
        if (!id || !m.createdAt) continue;
        const prev = buyers.get(id);
        if (!prev || m.createdAt < prev) buyers.set(id, m.createdAt);
    }

    const converted = [...buyers.keys()].filter((id) => first.has(id));

    // The median rather than the mean: one person who bought a month later would
    // drag an average anywhere.
    const gaps = converted
        .map((id) => (buyers.get(id) - first.get(id)) / 86400e3)
        .filter((d) => d >= 0)
        .sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const sameDay = gaps.filter((d) => d < 1).length;

    const gone = await buyersWhoLeft(client, [...buyers.keys()]);
    const leftAltogether = Math.max(first.size - guild.memberCount, 0);

    const lines = [
        "# Members",
        "### Joined",
        `• today — ${since(24)}`,
        `• 7 days — ${since(24 * 7)}`,
        `• 30 days — ${since(24 * 30)}`,
        `• since ${new Date(oldest).toISOString().slice(0, 10)} — ${first.size} people` +
        (rows.length > first.size ? ` (${rows.length - first.size} came back later)` : ""),
        "",
        "### Last 14 days",
        ...chart(rows, 14),
        "",
        "### Bought something",
        `${converted.length} of ${first.size} — **${(converted.length / first.size * 100).toFixed(1)}%**`,
    ];

    if (median !== null) {
        lines.push(
            `${sameDay} bought the day they arrived; the middle one took ` +
            `${median < 1 ? "under a day" : `${Math.round(median)} day(s)`}`);
    }

    lines.push(
        "",
        "### Left",
        `${guild.memberCount} still here, ${leftAltogether} gone`,
        `• ${gone.length} of them had bought something`,
        `• ${Math.max(leftAltogether - gone.length, 0)} left without buying`);

    if (gone.length) {
        // Worth a name each: somebody who paid and then left is a different
        // problem from somebody who looked around and did not stay.
        const named = gone.slice(0, 8).map((id) => {
            const mark = marks.find((m) => String(m.discordId) === id);
            return `  ${mark?.email || id} — ${mark?.productTitle || "?"}`;
        });
        lines.push("", ...named);
        if (gone.length > 8) lines.push(`  … and ${gone.length - 8} more`);
    }

    if (buyers.size > converted.length) {
        lines.push(
            "",
            `-# ${buyers.size - converted.length} buyer(s) joined before the log ` +
            "starts and are not in the percentage.");
    }

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* -------------------------------------------------------------- /winback --- */

/**
 * Who would be asked why they did not finish, and what they would be sent.
 *
 * Read-only on purpose. The sweep messages real customers unprompted, so the
 * sensible order is to look at the list and the wording first and turn it on
 * afterwards, rather than discovering both at once in somebody's DMs.
 */
async function winback(interaction, client) {
    const { candidates, load, startLine } = require("./winback");

    let people;
    try {
        people = await candidates(client);
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const since = startLine();
    const asked = Object.fromEntries(
        Object.entries(load()).filter(([k]) => !k.startsWith("__")));
    const answers = Object.entries(asked).filter(([, v]) => v.answered);

    const on = process.env.WINBACK === "on";
    const lines = [
        on
            ? `**Asking is on** — every hour, ${process.env.WINBACK_AFTER_HOURS || 3}h after a checkout stalls.`
            : "**Asking is off.** Put `WINBACK=on` in .env and restart to turn it on.",
        "",
    ];

    lines.push(
        `_Only checkouts abandoned after ${new Date(since).toISOString().slice(0, 16).replace("T", " ")} ` +
        "are ever asked about — anybody who gave up before that has forgotten this shop exists._",
        "");

    if (people.length === 0) {
        lines.push("_Nobody is waiting to be asked right now._");
    } else {
        lines.push(`**${people.length} would be asked:**`);
        for (const p of people.slice(0, 10)) {
            lines.push(`• <@${p.discordId}> — ${p.shown || p.product} — ${new Date(p.at).toISOString().slice(0, 10)}`);
        }
    }

    lines.push("", `**Already asked** — ${Object.keys(asked).length}, of whom ${answers.length} replied`);
    for (const [id, v] of answers.slice(-5)) {
        lines.push(`• <@${id}> — ${String(v.answered).slice(0, 120)}`);
    }

    lines.push(
        "",
        "**They get one message, once, ever:**",
        "> Hey — you started getting **<product>** a little while ago and it didn't go through.",
        "> This isn't a sales pitch and there's nothing to click to buy. If something got in the way",
        "> I'd just like to know what, because it's probably getting in somebody else's way too.",
        "",
        "_With four buttons: payment failed · too expensive · changed my mind · something else._");

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/** The button panel. Defined here so it lands in the same permission gate. */
async function admin(interaction) {
    const { buildPanel } = require("./adminPanel");
    return interaction.editReply(buildPanel());
}

const HANDLERS = {
    admin,
    customer,
    revokekey: (i) => setKeyState(i, true),
    restorekey: (i) => setKeyState(i, false),
    lapsed,
    grantrole,
    deliver,
    refund,
    resend,
    stats,
    unrefund,
    pending,
    abandoned,
    top,
    members,
    winback,
    vouch,
    vouchpanel,
    sync,
    health,
};

/**
 * Fill the member caches before anybody asks for them.
 *
 * Cold, /members takes half a minute: fourteen pages of join history and a
 * member lookup for every buyer, most of that spent waiting on rate limits.
 * Warmed in the background it is instant, and half a minute of staring at
 * "thinking..." is the difference between a report somebody checks and one they
 * stop opening.
 *
 * Failures are ignored on purpose. This is a convenience; the command still
 * works without it, just slowly.
 */
function warmMemberStats(client) {
    const run = async () => {
        try {
            const rows = await joinLog(client);
            const buyers = new Set(
                Object.values(require("./watermarkStore.json"))
                    .map((m) => String(m.discordId || ""))
                    .filter(Boolean));
            await buyersWhoLeft(client, [...buyers]);
            console.log(`[members] ${rows.length} join(s) cached`);
        } catch (err) {
            console.warn("[members] could not warm the cache:", err.message);
        }
    };

    setTimeout(run, 30_000);
    setInterval(run, 55 * 60 * 1000).unref?.();
}

/** @returns {Promise<boolean>} whether this interaction was one of ours */
async function handleAdminCommand(interaction, client) {
    const handler = HANDLERS[interaction.commandName];
    if (!handler) return false;

    // flags rather than the deprecated `ephemeral` boolean.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        await handler(interaction, client);
    } catch (err) {
        console.error(`[admin] /${interaction.commandName} failed:`, err);
        await interaction.editReply(`Something broke: ${err.message}`);
    }
    return true;
}

module.exports = { handleAdminCommand, warmMemberStats, HANDLERS };
