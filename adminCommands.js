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
const { getAllPurchases } = require("./purchaseStore");
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

/* ------------------------------------------------------------------------- */

const HANDLERS = {
    customer,
    revokekey: (i) => setKeyState(i, true),
    restorekey: (i) => setKeyState(i, false),
    lapsed,
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
