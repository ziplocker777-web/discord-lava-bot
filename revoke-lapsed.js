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
const { resolveTierWithLegacyFallback, TIERS, SUBSCRIPTION_PRODUCT_ID } = require("./roles");
const { findByOwner, setRevoked } = require("./watermarkStore");
const { notifyOwner } = require("./ownerNotify");
const { writeJson } = require("./jsonStore");

const APPLY = process.argv.includes("--apply");

/**
 * Days between losing the role and losing the configurator key.
 *
 * The two are not the same kind of loss. A role is soft -- channels close, and
 * one command puts it back. A key is hard: the app already installed on
 * someone's machine stops opening. Cards expire and banks decline for reasons
 * that get fixed in a day or two, and bricking a paying customer's tool over
 * that costs far more than three days of access does.
 */
const KEY_GRACE_DAYS = 3;

/** A date on the shop's own clock, not UTC. lava.top hands back ISO strings. */
const day = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "—";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const LOG_PATH = path.join(__dirname, "revokeLog.json");
const EXEMPT_PATH = path.join(__dirname, "revokeExempt.json");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 45000,
});

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
            expiredAt: null,
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

        // The three dates are not interchangeable, and the difference decides
        // whether someone keeps what they paid for:
        //
        //   terminatedAt   killed now, because the money stopped
        //   expiredAt      cancelled, but paid up until this date
        //   cancelledAt    when they pressed cancel, which is neither
        //
        // Somebody who cancels on the 9th with expiredAt on the 8th of next month
        // has a month of access left. Reading cancelledAt as the end -- as this
        // did -- would take it away from them on the day they cancelled.
        if (row.subscriptionDetails?.terminatedAt) {
            entry.terminatedAt = row.subscriptionDetails.terminatedAt;
        }
        if (row.subscriptionDetails?.expiredAt) {
            entry.expiredAt = row.subscriptionDetails.expiredAt;
        }

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

    const lines = done.map((d) => {
        const took = [d.role ? "role removed" : null, d.key ? `key ${d.key} revoked` : null]
            .filter(Boolean).join(", ");
        return `• ${d.email} — ${d.tier}, ended ${day(d.terminatedAt)} — ${took}`;
    });

    const heading = done.length === 1
        ? "**Subscription ended**"
        : `**Subscriptions ended** (${done.length})`;

    let body = `${heading}\n\n${lines.join("\n")}`;
    if (body.length > 1900) body = `${body.slice(0, 1900)}\n… and more — the full list is in revokeLog.json`;

    // Closed DMs must not turn a completed sweep into a failed one: the roles are
    // already gone and revokeLog.json already says so, which is what notifyOwner
    // does about a failure to send.
    await notifyOwner(client, body);
}

function record(entries) {
    const log = readJson(LOG_PATH, []);
    log.push(...entries);
    writeJson(LOG_PATH, log);
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
                role: true,
                key: "XXXX-XXXX-XXXX-XXXX",
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
    const now = Date.now();

    /**
     * Is this subscription over?
     *
     * Two ways for it to be, and one of them lava.top still calls ACTIVE: a
     * cancelled subscription keeps that status until its paid period runs out,
     * so the date has to be read rather than the label.
     */
    const lapsed = (s) => {
        if (s.expiredAt) {
            const ends = Date.parse(s.expiredAt);
            return Number.isFinite(ends) && ends < now;
        }
        return s.status === "FAILED";
    };

    for (const s of subs) s.lapsed = lapsed(s);

    // Built from what is really still running, not from the label: an expired
    // subscription that still reads ACTIVE must not shield its owner from this.
    const active = new Set(subs.filter((s) => !s.lapsed && s.discordId)
        .map((s) => s.discordId));

    console.log(`${invoices.length} invoice(s), ${subs.length} subscription(s): ` +
        `${active.size} still running, ${subs.filter((s) => s.lapsed).length} over\n`);

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
        if (!sub.lapsed) continue;

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
        console.log("\nNothing lapsed.");
        process.exit(0);
    }

    // Discord is checked before anything is reported, not only before anything is
    // removed: a report listing people whose role is already gone cannot be acted
    // on without checking every line by hand, which is the job it exists to do.
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once("ready", async () => {
        const plan = [];
        const done = [];

        try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const now = Date.now();

            for (const { sub, roleId, tier } of targets) {
                let holdsRole = false;

                try {
                    const member = await guild.members.fetch({ user: sub.discordId, force: true });
                    holdsRole = member.roles.cache.has(roleId);
                } catch {
                    console.log(`  -  left the server: ${sub.email}`);
                }

                // The key is chased even when the role has already gone, by hand or
                // on an earlier run: they lapse together but are taken separately,
                // and the key is the one that outlives everything.
                let key = null;
                // Counted from when access actually ended, which for a cancelled
                // subscription is the end of the paid period and not the day the
                // cancel button was pressed.
                const ended = Date.parse(sub.terminatedAt || sub.expiredAt || sub.last || "");
                const daysSince = Number.isFinite(ended) ? (now - ended) / 86400000 : 0;

                const record = findByOwner(sub.discordId, SUBSCRIPTION_PRODUCT_ID);
                if (record && !record.revoked) {
                    if (daysSince >= KEY_GRACE_DAYS) {
                        key = record.licenseKey;
                    } else {
                        const left = (KEY_GRACE_DAYS - daysSince).toFixed(1);
                        console.log(`  .  ${sub.email} — key kept for another ${left} day(s)`);
                    }
                }

                if (holdsRole || key) plan.push({ sub, roleId, tier, holdsRole, key });
            }

            if (plan.length === 0) {
                console.log("\nEvery lapsed subscription is already fully revoked.");
                process.exit(0);
            }

            console.log(`\n${plan.length} lapsed subscription(s) to act on:\n`);
            for (const p of plan) {
                const what = [p.holdsRole ? `role ${p.tier}` : null, p.key ? `key ${p.key}` : null]
                    .filter(Boolean).join(" + ");
                console.log(`  ${p.sub.email}  discord ${p.sub.discordId}  ${what}` +
                    `  ended ${day(p.sub.terminatedAt || p.sub.expiredAt || p.sub.last)}`);
            }

            if (!APPLY) {
                console.log("\nReport only. Re-run with --apply to carry this out.");
                process.exit(0);
            }

            console.log();
            for (const { sub, roleId, tier, holdsRole, key } of plan) {
                let roleGone = false;

                if (holdsRole) {
                    try {
                        const member = await guild.members.fetch({ user: sub.discordId, force: true });
                        await member.roles.remove(roleId);
                        roleGone = true;
                        console.log(`  ${tier} removed from ${sub.email}`);
                    } catch (err) {
                        console.warn(`  could not remove ${tier} from ${sub.email}: ${err.message}`);
                    }
                }

                let keyGone = null;
                if (key && setRevoked(key, true)) {
                    keyGone = key;
                    console.log(`  key ${key} revoked for ${sub.email}`);
                }

                if (roleGone || keyGone) {
                    done.push({
                        at: new Date().toISOString(),
                        discordId: sub.discordId,
                        email: sub.email,
                        tier,
                        roleId,
                        role: roleGone,
                        key: keyGone,
                        terminatedAt: sub.terminatedAt || sub.expiredAt || sub.last,
                        reason: "subscription terminated upstream",
                    });
                }
            }

            await notify(client, done);
        } catch (err) {
            console.error("Failed partway through:", err.message);
        } finally {
            if (done.length) record(done);
            if (APPLY) console.log(`\n${done.length} subscription(s) acted on.`);
            process.exit(0);
        }
    });

    client.login(process.env.DISCORD_TOKEN);
})();
