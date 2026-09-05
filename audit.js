require("./env.js").loadEnv();

/**
 * A standing audit of everything this bot claims to know.
 *
 * Written after a paging bug put revenue thirty-four per cent over for weeks and
 * was found only because a customer looked like they had been charged twice. The
 * point is not to look around once: every check here compares two things that
 * must agree, so a future disagreement surfaces on its own rather than waiting
 * for somebody to notice.
 *
 * Read-only. It changes nothing, ever.
 *
 * node audit.js            everything
 * node audit.js --quick    skip the per-member Discord checks (no API crawl)
 */

const axios = require("axios");
const { Client, GatewayIntentBits } = require("discord.js");
const { getRolesForPurchase, resolveTierWithLegacyFallback, TIERS } = require("./roles.js");
const { productCount } = require("./collector.js");

const QUICK = process.argv.includes("--quick");

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 30000,
});

const load = (f) => { try { return require("./" + f); } catch { return null; } };

const purchases = load("purchaseStore.json") || {};
const marks = load("watermarkStore.json") || {};
const vouches = load("vouchStore.json") || {};
const refunded = load("refundedEmails.json") || [];
const panels = load("panelStore.json") || {};

/**
 * The owner's own accounts, which are not customers.
 *
 * His testing put seven purchases with no role and a record with no productId
 * into every run. A report that always shows the same seven complaints is one
 * nobody reads closely, and a real eighth would have hidden among them.
 *
 * The count of what was skipped is still printed. Excluding quietly would be a
 * worse habit than the noise.
 */
const own = load("ownAccounts.json") || { emails: [], discordIds: [] };
const ownEmails = new Set((own.emails || []).map((e) => String(e).toLowerCase()));
const ownIds = new Set((own.discordIds || []).map(String));
const isOwn = (email, discordId) =>
    ownEmails.has(String(email || "").toLowerCase()) || ownIds.has(String(discordId || ""));
let skipped = 0;

const findings = [];
const note = (level, what, detail) => findings.push({ level, what, detail });
const lower = (s) => String(s || "").toLowerCase();
const SEP = "\n      ";

let checks = 0;
const ok = (what) => { checks += 1; console.log(`  ok    ${what}`); };
const bad = (what, detail) => {
    checks += 1;
    console.log(`  ЖАЛОБА ${what}`);
    note("!", what, detail);
};

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

(async () => {
    console.log("=".repeat(64));
    console.log("АУДИТ");
    console.log("=".repeat(64));

    // ================================================================ ДЕНЬГИ
    console.log("\n[1] счета lava.top\n");

    const rows = await allInvoices();
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (new Set(ids).size === ids.length) ok(`${rows.length} счетов, повторов нет`);
    else bad(`повторы в списке счетов`, `${ids.length - new Set(ids).size} дубликатов`);

    const paid = rows.filter((r) => String(r.status).toUpperCase() === "COMPLETED");
    const statuses = new Map();
    for (const r of rows) statuses.set(r.status, (statuses.get(r.status) || 0) + 1);
    console.log(`        статусы: ${[...statuses].map(([s, n]) => `${s}=${n}`).join(", ")}`);

    // A refunded sale keeps reading COMPLETED at lava.top for ever, so the only
    // record that it happened is ours. If that list is empty while refunds have
    // been given, every revenue figure is over.
    const refundedPaid = paid.filter((r) => refunded.includes(lower(r.buyer?.email)));
    if (refunded.length === 0) {
        note("?", "список возвратов пуст",
            "если возвраты были, они всё ещё считаются выручкой: lava.top навсегда оставляет им статус COMPLETED");
        console.log("  ?     список возвратов пуст — проверь, были ли возвраты вообще");
        checks += 1;
    } else ok(`${refunded.length} возврат(ов) на учёте, ${refundedPaid.length} нашлись среди счетов`);

    // Money that arrives is amount minus fee. A row missing `fee` silently
    // reports the gross for that sale.
    const noFee = paid.filter((r) => r.receipt && typeof r.receipt.fee !== "number");
    if (noFee.length) bad(`${noFee.length} счёт(ов) без поля fee`,
        "для них комиссия не вычтется и выручка будет завышена");
    else ok("у всех оплаченных счетов есть комиссия");

    // ============================================================== ХРАНИЛИЩА
    console.log("\n[2] база покупок\n");

    const noProductId = [];
    const noDiscord = [];
    const noRole = [];
    for (const [email, list] of Object.entries(purchases)) {
        for (const p of list) {
            if (isOwn(email, p.discordId)) { skipped += 1; continue; }
            if (!p.productId && !p.product?.id) noProductId.push(`${email}: ${JSON.stringify(p).slice(0, 90)}`);
            if (!p.discordId) noDiscord.push(email);
            if (getRolesForPurchase(p).length === 0) noRole.push(`${email}: ${p.productTitle || p.productId || "?"}`);
        }
    }

    if (noProductId.length) bad(`${noProductId.length} запис(ей) без productId`,
        "такая покупка не сопоставляется с товаром:\n      " + noProductId.slice(0, 6).join("\n      "));
    else ok("у всех записей есть productId");

    if (noDiscord.length) bad(`${new Set(noDiscord).size} адрес(ов) без привязки к Discord`,
        "им нельзя выдать роль, пока они не пройдут /getrole:\n      " + [...new Set(noDiscord)].slice(0, 8).join(", "));
    else ok("все покупки привязаны к Discord");

    if (noRole.length) bad(`${noRole.length} покупк(а) не даёт никакой роли`,
        noRole.slice(0, 6).join("\n      "));
    else ok("каждая покупка сопоставлена с ролью");

    // One email on two Discord accounts is how a shared login shows up; one
    // account on many emails is usually somebody buying twice, which is fine.
    const emailToIds = new Map();
    const idToEmails = new Map();
    for (const [email, list] of Object.entries(purchases)) {
        for (const p of list) {
            if (!p.discordId) continue;
            (emailToIds.get(email) || emailToIds.set(email, new Set()).get(email)).add(String(p.discordId));
            (idToEmails.get(String(p.discordId)) || idToEmails.set(String(p.discordId), new Set()).get(String(p.discordId))).add(email);
        }
    }
    const shared = [...emailToIds].filter(([, s]) => s.size > 1);
    if (shared.length) bad(`${shared.length} адрес(ов) привязаны к нескольким Discord`,
        shared.map(([e, s]) => `${e} -> ${[...s].join(", ")}`).join("\n      "));
    else ok("один адрес — один Discord");

    const many = [...idToEmails].filter(([, s]) => s.size > 1);
    console.log(`        ${many.length} человек(а) покупали с разных адресов — это нормально`);

    // ==================================================================== КЛЮЧИ
    console.log("\n[3] ключи\n");

    const keyed = new Set(Object.values(marks).map((m) => lower(m.email)));
    const KEY_PRODUCTS = new Set(["Muzzle Core FX"]);

    const shouldHaveKey = Object.entries(purchases)
        .filter(([, list]) => list.some((p) => KEY_PRODUCTS.has(p.productTitle)))
        .map(([email]) => email);
    const missingKey = shouldHaveKey.filter((e) => !keyed.has(lower(e)));

    if (missingKey.length) note("?", `${missingKey.length} покупател(ей) Muzzle Core FX без ключа`,
        "они его не активировали — это /pending, не поломка:\n      " + missingKey.slice(0, 8).join(", "));
    console.log(`  ${missingKey.length ? "?    " : "ok   "} ${shouldHaveKey.length} купили Muzzle Core FX, ${shouldHaveKey.length - missingKey.length} активировали ключ`);
    checks += 1;

    const orphanKeys = Object.values(marks).filter((m) => !purchases[lower(m.email)]);
    if (orphanKeys.length) bad(`${orphanKeys.length} ключ(ей) без записи о покупке`,
        orphanKeys.slice(0, 8).map((m) => `${m.email} ${m.licenseKey}`).join("\n      "));
    else ok("у каждого ключа есть покупка");

    const revokedKeys = Object.values(marks).filter((m) => m.revoked);
    console.log(`        отозванных ключей: ${revokedKeys.length}`);

    // =================================================================== ОТЗЫВЫ
    console.log("\n[4] отзывы\n");

    const rated = Object.entries(vouches).filter(([k, r]) => !k.startsWith("__") && r && r.rating);
    const ownerRated = rated.filter(([, r]) => r.owner);
    const noProduct = rated.filter(([, r]) => !r.product);

    ok(`${rated.length} оценок, из них ${ownerRated.length} владельца (не считаются)`);
    if (noProduct.length) bad(`${noProduct.length} оценок без товара`,
        "они не попадут в рейтинг ни одной панели");
    else ok("у каждой оценки есть товар");

    const outOfRange = rated.filter(([, r]) => !(r.rating >= 1 && r.rating <= 5));
    if (outOfRange.length) bad(`${outOfRange.length} оценок вне диапазона 1-5`, "");
    else ok("все оценки в диапазоне 1-5");

    // ================================================================== ПАНЕЛИ
    console.log("\n[5] панели\n");

    const panelProducts = new Set(Object.values(panels).map((p) => p.product));
    const baked = Object.entries(panels).filter(([, p]) => (p.base || "").includes("⭐"));
    if (baked.length) bad(`${baked.length} панел(ей) с рейтингом, впечатанным в базовый текст`,
        "при следующем обновлении строки начнут накапливаться");
    else ok(`${Object.keys(panels).length} панелей, базовый текст чистый`);
    console.log(`        товары на панелях: ${[...panelProducts].join(", ")}`);

    if (QUICK) { report(); return; }

    // ============================================================== DISCORD
    console.log("\n[6] роли в Discord (перебор покупателей — небыстро)\n");

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await new Promise((res) => { client.once("clientReady", res); client.login(process.env.DISCORD_TOKEN); });
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const ownerId = String(guild.ownerId);

    // --- who paid and has no role ---
    const tierRoleIds = new Set([
        process.env.BASIC_ROLE_ID,
        process.env.SUBSCRIBE_ROLE_ID,
        process.env.PREMIUM_ROLE_ID,
    ].filter(Boolean));

    const roleMissing = [];
    const gone = [];
    const collectorWrong = [];
    const COLLECTOR = process.env.COLLECTOR_ROLE_ID;

    const targets = [...idToEmails.entries()];
    for (const [discordId, emails] of targets) {
        if (isOwn([...emails][0], discordId)) { skipped += 1; continue; }

        let member;
        try {
            member = await guild.members.fetch({ user: discordId, force: true });
        } catch {
            gone.push([...emails][0]);
            continue;
        }

        for (const email of emails) {
            for (const p of purchases[email] || []) {
                // Only the shared customer role. Tier roles come and go with the
                // subscription -- paytinsalat7 and tyreekpatterson65 lost theirs
                // because their subscriptions ended, which is the system working,
                // and reporting that as a missing role is how a check earns being
                // ignored. Section 7 checks tiers properly, against who is paying.
                for (const roleId of getRolesForPurchase(p).filter((id) => !tierRoleIds.has(id))) {
                    if (!member.roles.cache.has(roleId)) {
                        roleMissing.push(`${email} · ${p.productTitle || p.productId} · нет ${guild.roles.cache.get(roleId)?.name || roleId}`);
                    }
                }
            }
        }

        if (COLLECTOR && discordId !== ownerId) {
            // Asked of the same function the grant uses, rather than counted here.
            // Summing the lists double-counted one product bought under two
            // addresses -- qwerty22800001 and lapha97 are one person with one
            // subscription, and this reported them as owing a badge for weeks.
            const products = productCount([...emails][0], discordId);
            const has = member.roles.cache.has(COLLECTOR);
            if (products >= 2 && !has) collectorWrong.push(`${[...emails][0]} — ${products} товара, значка нет`);
            if (products < 2 && has) collectorWrong.push(`${[...emails][0]} — ${products} товар, а значок есть`);
        }
    }

    if (roleMissing.length) bad(`${roleMissing.length} покупк(а) без выданной роли`,
        roleMissing.slice(0, 12).join("\n      "));
    else ok(`${targets.length} покупателей проверено, у всех роли на месте`);

    if (gone.length) console.log(`        ${gone.length} покупател(ей) вышли с сервера`);

    if (collectorWrong.length) bad(`Collector выдан неверно у ${collectorWrong.length}`,
        collectorWrong.slice(0, 12).join("\n      "));
    else ok("Collector совпадает с числом товаров у всех");

    // --- subscriptions: expired but still holding the role ---
    console.log("\n[7] подписки\n");

    // Grouped by PERSON, not by invoice.
    //
    // The first version of this check grouped by invoice id and reported twenty
    // lapsed subscriptions still holding their role. Every one was wrong:
    // renewals split into separate groups, and some of those people had simply
    // subscribed again under a second address. revoke-lapsed had it right all
    // along -- it links by Discord account, the only identity that survives
    // somebody using a different email the second time.
    //
    // An audit that cries wolf is worse than no audit, so this one links the
    // same way.
    const people = new Map();
    for (const r of rows) {
        if (!r.subscriptionStatus) continue;
        const who = r.clientUtm?.utm_content ? String(r.clientUtm.utm_content) : lower(r.buyer?.email);
        if (!who) continue;
        const e = people.get(who) || { rows: [], discordId: null, email: lower(r.buyer?.email) };
        e.rows.push(r);
        if (r.clientUtm?.utm_content) e.discordId = String(r.clientUtm.utm_content);
        people.set(who, e);
    }

    const now = Date.now();
    const anyTierRole = [
        process.env.BASIC_ROLE_ID,
        process.env.SUBSCRIBE_ROLE_ID,
        process.env.PREMIUM_ROLE_ID,
    ].filter(Boolean);

    let subsRight = 0;
    let subsLeft = 0;
    const holdingWrongly = [];
    const lostRole = [];

    for (const [, e] of people) {
        if (!e.discordId) continue;

        const live = e.rows.some((r) => {
            const exp = r.subscriptionDetails?.expiredAt;
            return exp ? Date.parse(exp) > now : r.subscriptionStatus === "ACTIVE";
        });

        let m;
        try {
            m = await guild.members.fetch({ user: e.discordId, force: true });
        } catch {
            subsLeft += 1;
            continue;
        }

        const held = anyTierRole.filter((id) => m.roles.cache.has(id));

        if (live === (held.length > 0)) { subsRight += 1; continue; }

        const statuses = [...new Set(e.rows.map((r) => r.subscriptionStatus))].join("/");
        if (live) {
            lostRole.push(`${e.email} — ${statuses}, платит и роли нет`);
        } else {
            const names = held.map((id) => guild.roles.cache.get(id)?.name).join(", ");
            holdingWrongly.push(`${e.email} — ${statuses}, не платит, роль осталась: ${names}`);
        }
    }

    if (holdingWrongly.length) {
        bad(`${holdingWrongly.length} человек(а) держат роль без действующей подписки`,
            holdingWrongly.join(SEP) + SEP + "(работа revoke-lapsed — проверь revoke-cron.log)");
    } else {
        ok(`${subsRight} подписчиков сверено, лишних ролей нет`);
    }

    if (lostRole.length) bad(`${lostRole.length} действующих подписок БЕЗ роли`, lostRole.join(SEP));
    else ok("у всех действующих подписок роль на месте");
    if (subsLeft) console.log(`        ${subsLeft} подписчик(ов) вышли с сервера`);

    client.destroy();
    report();
    process.exit(0);
})().catch((e) => { console.error("\nаудит сломался:", e.message); process.exit(1); });

function report() {
    console.log("\n" + "=".repeat(64));
    const problems = findings.filter((f) => f.level === "!");
    const questions = findings.filter((f) => f.level === "?");

    console.log(`проверок: ${checks} · жалоб: ${problems.length} · на подумать: ${questions.length}`
        + (skipped ? ` · пропущено своих: ${skipped}` : ""));
    console.log("=".repeat(64));

    for (const f of [...problems, ...questions]) {
        console.log(`\n${f.level === "!" ? "ЖАЛОБА" : "ВОПРОС"}: ${f.what}`);
        if (f.detail) console.log("      " + f.detail);
    }
    if (!findings.length) console.log("\nничего не найдено");
}
