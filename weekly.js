require("./env.js").loadEnv();

/**
 * One message a week about what changed, rather than a hundred about what
 * happened.
 *
 * The bot already reports events: a sale, a renewal, a rating. What it has never
 * reported is a trend. Takings halving over a week would show up nowhere, and
 * the notification that mattered -- a key revoked -- was missed among
 * twenty-five others. This is the other half: no single event, just the numbers
 * against last week's, so a change is visible without going looking for it.
 *
 * Every figure is compared with the seven days before, because a number on its
 * own says nothing. 22 sales is good or bad depending entirely on what 22 was
 * last time.
 *
 * node weekly.js           print it, send nothing
 * node weekly.js --send    send it
 */

const axios = require("axios");
const { Client, GatewayIntentBits } = require("discord.js");

const { notifyOwner } = require("./ownerNotify");
const { isRefunded } = require("./refundedEmails");
const { isRefundedInvoice } = require("./refundedInvoices");
const { joinLog } = require("./adminCommands.js");
const { readJson } = require("./jsonStore");
const path = require("path");

const SEND = process.argv.includes("--send");
const WEEK = 7 * 24 * 3600e3;

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

const lower = (s) => String(s || "").toLowerCase();
const at = (r) => Date.parse(r.datetime || r.created || "");

/** Handed back, by either list. Money that came back is not takings. */
const refunded = (r) => isRefunded(lower(r.buyer?.email)) || isRefundedInvoice(r);

/** "+38%", "-12%", or a word when there is nothing to compare against. */
function change(now, before) {
    if (!before) return now ? "new" : "—";
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return "unchanged";
    return `${pct > 0 ? "+" : ""}${pct}%`;
}

async function allInvoices() {
    const out = [];
    const seen = new Set();
    for (let page = 0; page < 20; page += 1) {
        const { data } = await lava.get("/invoices", { params: { page, size: 100 } });
        const items = data.items || [];
        for (const r of items) {
            if (r.id && seen.has(r.id)) continue;
            if (r.id) seen.add(r.id);
            out.push(r);
        }
        if (items.length < 100) break;
    }
    return out;
}

/** The tier is the product as far as anybody here is concerned. */
function nameOf(r) {
    const name = r.product?.name || "?";
    if (name === "Subscription ziplocker" && r.product?.offer) return `${r.product.offer} sub`;
    return name.replace(/^Ziplocker(?:'s)? /, "").replace(/^Muzzle Core FX \| /, "");
}

(async () => {
    const rows = await allInvoices();
    const now = Date.now();

    const paid = rows.filter((r) => String(r.status).toUpperCase() === "COMPLETED");
    const inWindow = (list, from, to) => list.filter((r) => {
        const t = at(r);
        return Number.isFinite(t) && t >= from && t < to;
    });

    const thisWeek = inWindow(paid, now - WEEK, now);
    const lastWeek = inWindow(paid, now - 2 * WEEK, now - WEEK);

    const net = (list) => list.reduce((total, r) =>
        total + (refunded(r) ? 0 : (r.receipt?.amount || 0) - (r.receipt?.fee || 0)), 0);

    const money = net(thisWeek);
    const moneyBefore = net(lastWeek);

    // ---- what sold -----------------------------------------------------------
    const sold = new Map();
    for (const r of thisWeek) sold.set(nameOf(r), (sold.get(nameOf(r)) || 0) + 1);
    const soldBefore = new Map();
    for (const r of lastWeek) soldBefore.set(nameOf(r), (soldBefore.get(nameOf(r)) || 0) + 1);

    const products = [...sold.entries()].sort((a, b) => b[1] - a[1]);

    // ---- subscriptions -------------------------------------------------------
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
    const running = [...subs.values()].filter((s) =>
        s.expiredAt ? Date.parse(s.expiredAt) > now : s.status === "ACTIVE").length;

    // ---- people --------------------------------------------------------------
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    });
    await new Promise((res) => { client.once("clientReady", res); client.login(process.env.DISCORD_TOKEN); });

    let joined = null;
    let joinedBefore = null;
    try {
        const log = await joinLog(client);
        joined = log.filter((r) => r.at >= now - WEEK).length;
        joinedBefore = log.filter((r) => r.at >= now - 2 * WEEK && r.at < now - WEEK).length;
    } catch { /* the joins channel is a nicety here, not a requirement */ }

    // ---- ratings -------------------------------------------------------------
    const vouches = readJson(path.join(__dirname, "vouchStore.json"), {});
    const rated = Object.entries(vouches)
        .filter(([id, r]) => !id.startsWith("__") && r && r.rating && !r.owner);
    const fresh = rated.filter(([, r]) => (r.ratedAt || 0) >= now - WEEK);
    const average = rated.length
        ? (rated.reduce((t, [, r]) => t + r.rating, 0) / rated.length).toFixed(1)
        : null;

    // ---- anything that went wrong -------------------------------------------
    const refundsThisWeek = thisWeek.filter(refunded).length;
    // Counted per subscription, not per invoice: lava.top retries a failed charge
    // and each attempt is its own row, so one struggling customer would otherwise
    // be reported as three.
    const failedRenewals = new Set(
        inWindow(rows.filter((r) => String(r.subscriptionStatus || "").toUpperCase() === "FAILED"),
            now - WEEK, now)
            .map((r) => r.parentInvoice?.id || r.id)).size;

    // ---- write it out --------------------------------------------------------
    const lines = [
        "# This week",
        "",
        "### Money",
        `• ${money.toFixed(2)} USD — ${change(money, moneyBefore)} on last week`,
        `• ${thisWeek.length} sale(s) — ${change(thisWeek.length, lastWeek.length)}` +
        ` (was ${lastWeek.length})`,
    ];

    if (products.length) {
        lines.push("", "### What sold", "```");
        const widest = Math.max(...products.map(([n]) => n.length), 8);
        for (const [name, n] of products) {
            const was = soldBefore.get(name) || 0;
            lines.push(`${name.padEnd(widest)}  ${String(n).padStart(3)}   ${was ? `was ${was}` : "new"}`);
        }
        lines.push("```");
    }

    lines.push("", "### Subscriptions", `• ${running} running`);
    if (failedRenewals) {
        lines.push(`• ${failedRenewals} renewal(s) failed this week`);
    }

    if (joined !== null) {
        lines.push(
            "",
            "### People",
            `• ${joined} joined — ${change(joined, joinedBefore)} (was ${joinedBefore})`,
            // Deliberately not called a conversion rate. The people who bought this
            // week are mostly not the people who arrived this week -- the median gap
            // between joining and buying is five days -- so it is printed as the
            // ratio it is and left at that.
            `• ${thisWeek.length} sale(s) against ${joined} arrivals`);
    }

    if (average) {
        lines.push("", "### Reviews",
            `• ${average} out of 5, ${rated.length} in total` +
            (fresh.length ? ` — ${fresh.length} this week` : ` — none new`));
    }

    if (refundsThisWeek) {
        lines.push("", "### Worth a look", `• ${refundsThisWeek} refund(s) this week`);
    }

    const body = lines.join("\n").slice(0, 1900);

    console.log(body);

    if (SEND) {
        const ok = await notifyOwner(client, body);
        console.log(`\n${ok ? "sent" : "COULD NOT SEND"}`);
    } else {
        console.log("\n— dry run, nothing sent. --send to send it.");
    }

    client.destroy();
    process.exit(0);
})().catch((e) => { console.error("failed:", e.message); process.exit(1); });
