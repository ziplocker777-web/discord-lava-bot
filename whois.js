require("./env.js").loadEnv();

/**
 * Everything known about one customer, from every place that holds an answer.
 *
 *   node whois.js someone@example.com
 *   node whois.js 867329858059894826
 *
 * Built after an afternoon of asking the same question four different ways and
 * getting four different answers. lava.top keeps three separate lists and they
 * do not agree with each other:
 *
 *   /sales         one row per subscription, but its `amount` is the CURRENT
 *                  offer price rather than what was charged, and its `status`
 *                  can sit at "new" long after the dashboard says Canceled
 *   /subscriptions only successful and failed CHARGES, so a subscription that
 *                  never took a payment does not appear at all
 *   /invoices      the checkout itself, including ones stuck at IN_PROGRESS,
 *                  and the only place carrying clientUtm -> the discord id
 *
 * The dashboard is still the final word. This prints all of them side by side so
 * the disagreement is visible instead of being guessed at.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const KEY = process.env.LAVA_API_KEY;
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.GUILD_ID;

const query = (process.argv[2] || "").trim().toLowerCase();
if (!query) {
    console.error("usage: node whois.js <email | discord id>");
    process.exit(1);
}

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": KEY },
    timeout: 45000,
});

const ROLE_NAMES = {
    [process.env.ROLE_ID]: "Customer",
    [process.env.COLLECTOR_ROLE_ID]: "Collector",
    [process.env.SUBSCRIBE_ROLE_ID]: "Membership",
    [process.env.BASIC_ROLE_ID]: "Basic",
    [process.env.PREMIUM_ROLE_ID]: "Premium",
};

async function pages(url, attempt = 0) {
    const out = [];
    for (let p = 0; p < 8; p += 1) {
        let data;
        try {
            ({ data } = await lava.get(url, { params: { page: p, size: 100 } }));
        } catch (err) {
            if (attempt >= 1) throw err;
            return pages(url, attempt + 1);
        }
        const items = data.items || [];
        out.push(...items);
        if (items.length < 100) break;
    }
    return out;
}

const matches = (row) => JSON.stringify(row).toLowerCase().includes(query);

(async () => {
    console.log(`\nlooking up: ${query}\n`);

    // ---- lava.top, all three lists -----------------------------------------
    for (const [label, url] of [["invoices", "/invoices"], ["subscriptions", "/subscriptions"]]) {
        let rows = [];
        try {
            rows = (await pages(url)).filter(matches);
        } catch (err) {
            console.log(`  ${label}: lookup failed (${err.response?.status || err.message})`);
            continue;
        }
        console.log(`  ${label}: ${rows.length} record(s)`);
        for (const r of rows) {
            console.log(
                `     ${String(r.datetime || r.created).slice(0, 19)}  ` +
                `${String(r.status).padEnd(12)} ${String(r.subscriptionStatus || "").padEnd(9)} ` +
                `${r.receipt?.amount ?? r.amountTotal?.amount} ${r.receipt?.currency ?? r.amountTotal?.currency}  ` +
                `${r.product?.offer || r.product?.name || ""}`
            );
            const utm = r.clientUtm?.utm_content;
            if (utm) console.log(`        discord id: ${utm}`);
        }
    }

    // ---- what the bot itself recorded --------------------------------------
    const storePath = path.join(__dirname, "purchaseStore.json");
    if (fs.existsSync(storePath)) {
        const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
        const hits = [];
        for (const [email, list] of Object.entries(store)) {
            // Older records were stored as a bare object rather than a list.
            const rows = Array.isArray(list) ? list : list ? [list] : [];
            for (const r of rows) {
                if (email.toLowerCase().includes(query) || String(r.discordId) === query) hits.push([email, r]);
            }
        }
        console.log(`\n  purchaseStore: ${hits.length} record(s)`);
        for (const [email, r] of hits) {
            const when = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 19) : "?";
            // A contract that starts with "manual-" was granted by hand, not paid
            // for -- worth calling out, because nothing upstream will ever know
            // about it and no automatic revoke will ever touch it.
            const manual = String(r.contractId || "").startsWith("manual-") ? "  [GRANTED BY HAND]" : "";
            console.log(`     ${when}  ${r.productTitle || r.productId}  discord ${r.discordId || "-"}${manual}`);
        }
    }

    // ---- and what Discord shows right now -----------------------------------
    const ids = new Set();
    if (/^\d{17,20}$/.test(query)) ids.add(query);
    if (fs.existsSync(storePath)) {
        const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
        for (const [email, list] of Object.entries(store)) {
            if (!email.toLowerCase().includes(query)) continue;
            const rows = Array.isArray(list) ? list : list ? [list] : [];
            for (const r of rows) if (r.discordId) ids.add(String(r.discordId));
        }
    }

    console.log();
    for (const id of ids) {
        try {
            const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/members/${id}`, {
                headers: { Authorization: `Bot ${TOKEN}` },
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) {
                console.log(`  discord ${id}: ${r.status} — not on the server`);
                continue;
            }
            const m = await r.json();
            const held = m.roles.map((x) => ROLE_NAMES[x]).filter(Boolean);
            console.log(`  discord ${id} (${m.user?.username}) holds: ${held.join(", ") || "no bot roles"}`);
        } catch (err) {
            console.log(`  discord ${id}: ${err.message}`);
        }
    }
    console.log();
})();
