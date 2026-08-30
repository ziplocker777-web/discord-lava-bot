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
const { getRolesForProduct, resolveTierWithLegacyFallback, tierDownloadsChannelId } = require("./roles");
const { addRefund } = require("./refundedEmails");
const { deliverPurchase, buildDeliveryMessage } = require("./delivery");
const KNOWN_PRODUCT_IDS = require("./products");
const { MessageFlags } = require("discord.js");
const { search, setRevoked } = require("./watermarkStore");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

const ROLE_NAMES = () => ({
    [process.env.ROLE_ID]: "buyer",
    [process.env.SUBSCRIBE_ROLE_ID]: "Membership",
    [process.env.BASIC_ROLE_ID]: "Basic",
    [process.env.PREMIUM_ROLE_ID]: "Premium",
});

const when = (t) => (t ? new Date(t).toISOString().replace("T", " ").slice(0, 16) : "—");

/** Every subscription lava.top knows about for one buyer. */
async function subscriptionsFor(query) {
    const rows = [];
    for (let page = 0; page < 20; page += 1) {
        const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
        const items = data.items || [];
        rows.push(...items);
        if (items.length < 100) break;
    }

    const q = query.toLowerCase();
    const mine = rows.filter((r) =>
        String(r.buyer?.email || "").toLowerCase() === q
        || String(r.clientUtm?.utm_content || "") === query);

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
    const query = interaction.options.getString("who").trim();
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

    lines.push(`**${emails.join(", ") || "no email on file"}**`);
    if (ids.length) lines.push(ids.map((id) => `<@${id}>`).join(", "));

    // ---- what they bought
    const purchases = emails.flatMap((e) => getAllPurchases(e) || []);
    if (purchases.length) {
        lines.push("", "**Purchases**");
        for (const p of purchases) {
            const status = p.status ? ` — ${p.status}` : "";
            lines.push(`• ${p.productTitle || p.productId} — ${when(p.timestamp)}${status}`);
        }
    }

    // ---- keys
    if (keys.length) {
        lines.push("", "**Licence keys**");
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

    // ---- subscription, straight from lava.top
    try {
        const subs = await subscriptionsFor(emails[0] || query);
        if (subs.length) {
            lines.push("", "**Subscriptions**");
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
    const names = ROLE_NAMES();
    for (const id of ids) {
        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const member = await guild.members.fetch({ user: id, force: true });
            const held = member.roles.cache.map((r) => names[r.id]).filter(Boolean);
            lines.push("", `**Roles** — ${held.join(", ") || "none of ours"}`);
        } catch {
            lines.push("", `**Roles** — <@${id}> is not on the server`);
        }
    }

    return interaction.editReply(lines.join("\n").slice(0, 1990));
}

/* --------------------------------------------------- /revokekey /restorekey */

async function setKeyState(interaction, revoked) {
    const query = interaction.options.getString("who").trim();
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
    let rows = [];
    try {
        for (let page = 0; page < 20; page += 1) {
            const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
            const items = data.items || [];
            rows.push(...items);
            if (items.length < 100) break;
        }
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
        lines.push("", "**Cancelled, still paid for**");
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
    const user = interaction.options.getUser("user");
    const roleEnv = interaction.options.getString("role");
    const email = (interaction.options.getString("email") || "").trim().toLowerCase();

    const roleId = process.env[roleEnv];
    if (!roleId) {
        return interaction.editReply(`\`${roleEnv}\` is not set in .env — nothing to grant.`);
    }

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch({ user: user.id, force: true });

    if (member.roles.cache.has(roleId)) {
        return interaction.editReply(`<@${user.id}> already has that role.`);
    }

    await member.roles.add(roleId);

    let note = "";
    if (email) {
        recordPurchase(email, {
            productId: null,
            productTitle: `Granted by hand (${roleEnv})`,
            contractId: `manual-${Date.now()}`,
            discordId: user.id,
            status: "manual",
        });
        note = `\nRecorded against \`${email}\` — the nightly sweep will never take it back.`;
    }

    return interaction.editReply(`✅ Gave <@${user.id}> the **${roleEnv}** role.${note}`);
}

/* ---------------------------------------------------------------- /refund --- */

/**
 * Undo a sale the seller refunded.
 *
 * The same three things the webhook does, for a refund issued somewhere the
 * webhook did not see: the role, the key, and the block on claiming it again.
 */
async function refund(interaction, client) {
    const email = interaction.options.getString("email").trim().toLowerCase();
    const title = interaction.options.getString("product");

    const purchases = getAllPurchases(email) || [];
    if (purchases.length === 0) {
        return interaction.editReply(
            `No purchase on file for \`${email}\`. Blocking the email alone: run it again with a product if that was not what you wanted.`);
    }

    let purchase;
    if (title) {
        const productId = KNOWN_PRODUCT_IDS[title];
        purchase = getPurchaseForProduct(email, productId);
        if (!purchase) return interaction.editReply(`\`${email}\` has no purchase of **${title}**.`);
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

/* ---------------------------------------------------------------- /resend --- */

/**
 * Send somebody their download again.
 *
 * The same link and the same key, not new ones: deliverPurchase hands back what
 * already exists. For the buyer whose DMs were closed at the moment of purchase,
 * which is the one failure that leaves somebody having paid for nothing.
 */
async function resend(interaction, client) {
    const query = interaction.options.getString("who").trim();

    const keys = search(query);
    if (keys.length === 0) {
        return interaction.editReply("Nothing found — try an email, a Discord id, or the key itself.");
    }
    if (keys.length > 1) {
        const list = keys.map((k) => `• \`${k.licenseKey}\` — ${k.productTitle}`).join("\n");
        return interaction.editReply(`That matches ${keys.length} purchases — run it again with the exact key:\n${list}`);
    }

    const record = keys[0];
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
    let rows = [];
    try {
        for (let page = 0; page < 20; page += 1) {
            const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
            const items = data.items || [];
            rows.push(...items);
            if (items.length < 100) break;
        }
    } catch (err) {
        return interaction.editReply(`lava.top did not answer (${err.response?.status || err.message}).`);
    }

    const now = Date.now();
    const paid = rows.filter((r) => String(r.status).toUpperCase() === "COMPLETED");

    const within = (hours) => paid.filter((r) => {
        const t = Date.parse(r.datetime || r.created || "");
        return Number.isFinite(t) && now - t < hours * 3600e3;
    });

    const money = (list) => {
        const sums = {};
        for (const r of list) {
            const cur = r.receipt?.currency || r.amountTotal?.currency || "?";
            sums[cur] = (sums[cur] || 0) + (r.receipt?.amount ?? r.amountTotal?.amount ?? 0);
        }
        return Object.entries(sums).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(", ") || "—";
    };

    const day = within(24);
    const week = within(24 * 7);

    // Subscriptions that are genuinely still running: cancelled ones keep the
    // ACTIVE label until the period they paid for is over.
    const subs = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const id = r.parentInvoice?.id || r.id;
        const e = subs.get(id) || { status: null, expiredAt: null };
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

    return interaction.editReply([
        `**Last 24 hours** — ${day.length} sale(s), ${money(day)}`,
        `**Last 7 days** — ${week.length} sale(s), ${money(week)}`,
        "",
        `**Subscriptions running** — ${live.length}`,
        "",
        top ? `**This week**\n${top}` : "_No sales this week._",
    ].join("\n").slice(0, 1990));
}

/* ------------------------------------------------------------------------- */

const HANDLERS = {
    customer,
    revokekey: (i) => setKeyState(i, true),
    restorekey: (i) => setKeyState(i, false),
    lapsed,
    grantrole,
    refund,
    resend,
    stats,
};

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

module.exports = { handleAdminCommand };
