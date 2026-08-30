require("./env.js").loadEnv();

/**
 * Revokes tier roles from subscriptions lava.top has terminated.
 *
 *   node revoke-lapsed.js                report only, changes nothing
 *   node revoke-lapsed.js --apply        actually removes the roles
 *   node revoke-lapsed.js --test-notify  sends a sample DM and stops
 *
 * Why this exists rather than a webhook handler:
 *
 * Renewals do not arrive on the webhook. Three subscriptions have now lapsed
 * without the bot hearing a word -- paytinsalat7 failed three charges across two
 * days and not one event was delivered, while purchases in the same window came
 * through fine. Waiting for a cancellation event that never comes is why people
 * keep their roles after they stop paying.
 *
 * The API does know. Every recurring invoice carries the subscription's CURRENT
 * state, and a dead one is explicit about it:
 *
 *     "subscriptionStatus": "FAILED",
 *     "subscriptionDetails": { "terminatedAt": "...", "cancelledAt": "..." }
 *
 * That is a statement, not silence, which is what makes it safe to act on. The
 * earlier idea of revoking when no renewal event arrived would have stripped the
 * role from every paying subscriber, because no renewal event ever arrives for
 * anyone.
 *
 * Run it daily. Discord's own audit log will show the removals, and revokeLog.json
 * keeps a record that survives Discord's 90-day window.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { getAllPurchases } = require("./purchaseStore");
const { resolveTierWithLegacyFallback, TIERS } = require("./roles");

const APPLY = process.argv.includes("--apply");

const LOG_PATH = path.join(__dirname, "revokeLog.json");
const EXEMPT_PATH = path.join(__dirname, "revokeExempt.json");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 45000,
});

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
 * Group invoices into subscriptions.
 *
 * A renewal points at the original through parentInvoice.id, and every row of a
 * subscription carries the same current status -- the July payment that started
 * paytinsalat7's subscription now reads FAILED too, because the subscription is
 * what failed, not that payment.
 */
function subscriptions(invoices) {
    const byId = new Map();

    for (const row of invoices) {
        if (!row.subscriptionStatus) continue;   // a one-off purchase

        const id = row.parentInvoice?.id || row.id;
        const entry = byId.get(id) || {
            id,
            email: null,
            discordId: null,
            status: null,
            terminatedAt: null,
            offer: null,
            last: null,
        };

        if (row.buyer?.email) entry.email = row.buyer.email.toLowerCase();
        if (row.clientUtm?.utm_content) entry.discordId = String(row.clientUtm.utm_content);
        if (row.product?.offer) entry.offer = row.product.offer;

        // ACTIVE anywhere wins: someone who failed once and then subscribed
        // again is a paying customer, and must not be caught by this.
        if (row.subscriptionStatus === "ACTIVE") entry.status = "ACTIVE";
        else if (entry.status !== "ACTIVE") entry.status = row.subscriptionStatus;

        const terminated = row.subscriptionDetails?.terminatedAt
            || row.subscriptionDetails?.cancelledAt;
        if (terminated) entry.terminatedAt = terminated;

        const when = row.datetime || row.created;
        if (when && (!entry.last || when > entry.last)) entry.last = when;

        byId.set(id, entry);
    }

    return [...byId.values()];
}

/**
 * Which tier a subscription is, taken from the invoice itself.
 *
 * The invoice names the offer -- "Membership", "Premium" -- and that name is the
 * thing being sold, so it is right even where our own records are thin or the
 * buyer predates purchaseStore. Price is not usable for this: there are
 * Membership subscriptions at both 9.99 and 14.99, because the price changed and
 * the older subscribers kept theirs, so reading 14.99 as Premium would revoke
 * the wrong role from the wrong people.
 */
function tierFromOffer(offer) {
    if (!offer) return null;
    const wanted = String(offer).trim().toLowerCase();
    return TIERS.find((t) => t.label.toLowerCase() === wanted) || null;
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return fallback;
    }
}

/**
 * Tell the owner what was taken away.
 *
 * Straight to their DMs, and never into one of the existing channels: every
 * channel this bot knows about is one customers can read, and these lines carry
 * other customers' email addresses. REVOKE_NOTIFY_CHANNEL_ID overrides it for
 * anyone who would rather have a private staff channel -- but there is no
 * fallback to a public one, on purpose.
 *
 * Only speaks up when something actually happened. A daily "nothing to report"
 * is a message people stop reading, and then miss the one that mattered.
 */
async function notify(client, done) {
    if (done.length === 0) return;

    const lines = done.map((d) =>
        `• ${d.email} — ${d.tier}, подписка прекращена ${String(d.terminatedAt).slice(0, 10)}`);

    let body = `**Сняты роли за неоплату** — ${done.length}\n\n${lines.join("\n")}`;
    if (body.length > 1900) body = `${body.slice(0, 1900)}\n… и ещё несколько, полный список в revokeLog.json`;

    try {
        const channelId = process.env.REVOKE_NOTIFY_CHANNEL_ID;
        if (channelId) {
            const channel = await client.channels.fetch(channelId);
            await channel.send(body);
            return;
        }

        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const owner = await guild.fetchOwner();
        await owner.send(body);
    } catch (err) {
        // Closed DMs must not turn a completed sweep into a failed one: the roles
        // are already gone and revokeLog.json already says so.
        console.warn(`Could not send the notification (${err.message}) — see revokeLog.json.`);
    }
}

function record(entries) {
    const log = readJson(LOG_PATH, []);
    log.push(...entries);
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

(async () => {
    // Worth being able to prove the message arrives before relying on it: a DM
    // to a closed inbox fails silently, and the first real revocation is a bad
    // time to find that out.
    if (process.argv.includes("--test-notify")) {
        const probe = new Client({ intents: [GatewayIntentBits.Guilds] });
        probe.once("ready", async () => {
            await notify(probe, [{
                email: "example@example.com",
                tier: "membership",
                terminatedAt: new Date().toISOString(),
            }]);
            console.log("Test notification sent, unless a warning above says otherwise.");
            process.exit(0);
        });
        probe.login(process.env.DISCORD_TOKEN);
        return;
    }

    const exempt = new Set((readJson(EXEMPT_PATH, [])).map(String));

    let invoices;
    try {
        invoices = await allInvoices();
    } catch (err) {
        console.error(`lava.top unreachable (${err.response?.status || err.message}) — nothing done.`);
        process.exit(1);
    }

    const subs = subscriptions(invoices);
    const active = new Set(subs.filter((s) => s.status === "ACTIVE" && s.discordId)
        .map((s) => s.discordId));

    console.log(`${invoices.length} invoice(s), ${subs.length} subscription(s): ` +
        `${active.size} active, ${subs.filter((s) => s.status === "FAILED").length} failed\n`);

    const targets = [];

    // One person can own several dead subscriptions, and saying so six times
    // buries the line that matters.
    const said = new Set();
    const note = (reason, who) => {
        const key = `${reason}:${who}`;
        if (said.has(key)) return;
        said.add(key);
        console.log(`  ${reason} ${who}`);
    };

    for (const sub of subs) {
        if (sub.status !== "FAILED") continue;

        if (!sub.discordId) {
            note("?  no discord id on the invoice:", sub.email || sub.id);
            continue;
        }

        // A second, live subscription outranks a dead one.
        if (active.has(sub.discordId)) {
            note("-  paying on another subscription:", sub.email);
            continue;
        }

        if (exempt.has(sub.discordId)) {
            note("-  on the exempt list:", sub.email);
            continue;
        }

        // Roles handed out by hand have no upstream to go dead, so nothing here
        // should ever take one away.
        const purchases = getAllPurchases(sub.email) || [];
        const purchase = purchases.find((p) => String(p.discordId) === sub.discordId)
            || purchases[0];

        if (purchase && String(purchase.contractId || "").startsWith("manual-")) {
            note("-  granted by hand:", sub.email);
            continue;
        }

        // The invoice first, our own record only as a fallback: buyers from
        // before purchaseStore existed have no record to read.
        const tier = tierFromOffer(sub.offer) || resolveTierWithLegacyFallback(purchase || {});
        const roleId = tier && process.env[tier.roleEnv];

        if (!roleId) {
            // Better to be told about it than to guess and strip every tier.
            note("!  cannot tell which tier, needs a look:", `${sub.email} (${sub.discordId})`);
            continue;
        }

        // The same person can hold two dead subscriptions of the same tier.
        if (targets.some((t) => t.sub.discordId === sub.discordId && t.roleId === roleId)) continue;

        targets.push({ sub, roleId, tier: tier.key });
    }

    if (targets.length === 0) {
        console.log("\nNothing to revoke.");
        process.exit(0);
    }

    // Discord is checked before anything is reported, not only before anything is
    // removed. A report that lists people whose role is already gone cannot be
    // acted on -- it has to be re-checked by hand, which is the job it was meant
    // to do.
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once("ready", async () => {
        const holding = [];
        const done = [];

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);

            for (const target of targets) {
                const { sub, roleId, tier } = target;
                let member;
                try {
                    member = await guild.members.fetch({ user: sub.discordId, force: true });
                } catch {
                    console.log(`  -  left the server: ${sub.email}`);
                    continue;
                }
                if (!member.roles.cache.has(roleId)) {
                    console.log(`  -  ${tier} already gone: ${sub.email}`);
                    continue;
                }
                holding.push(target);
            }

            if (holding.length === 0) {
                console.log("\nEvery lapsed subscription has already had its role removed.");
                process.exit(0);
            }

            console.log(`\n${holding.length} lapsed subscription(s) still holding a role:\n`);
            for (const { sub, tier } of holding) {
                console.log(`  ${sub.email}  discord ${sub.discordId}  ${tier}` +
                    `  terminated ${String(sub.terminatedAt || sub.last).slice(0, 19)}`);
            }

            if (!APPLY) {
                console.log("\nReport only. Re-run with --apply to remove these roles.");
                process.exit(0);
            }

            console.log();
            for (const { sub, roleId, tier } of holding) {
                const member = await guild.members.fetch({ user: sub.discordId, force: true });
                await member.roles.remove(roleId);
                console.log(`  ${tier} removed from ${sub.email} (${sub.discordId})`);

                done.push({
                    at: new Date().toISOString(),
                    discordId: sub.discordId,
                    email: sub.email,
                    tier,
                    roleId,
                    terminatedAt: sub.terminatedAt || sub.last,
                    reason: "subscription terminated upstream",
                });
            }
            await notify(client, done);
        } catch (err) {
            console.error("Failed partway through:", err.message);
        } finally {
            if (done.length) record(done);
            if (APPLY) console.log(`\n${done.length} role(s) removed.`);
            process.exit(0);
        }
    });

    client.login(process.env.DISCORD_TOKEN);
})();
