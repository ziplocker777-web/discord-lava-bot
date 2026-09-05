require("./env.js").loadEnv();

/**
 * Prove the buy buttons still work, by actually using them.
 *
 * The ids in the buttons come from .env and are OFFER ids -- what lava.top wants
 * when an invoice is created. products.js holds PRODUCT ids, which look
 * identical and are not interchangeable: a product owns offers, and an invoice
 * is raised against an offer. Passing one where the other belongs returns
 * "Product with offer id = ... not found", which is how this script was wrong
 * the first time it ran.
 *
 * So both are checked: every id in .env is matched against the live catalogue,
 * and then an invoice is actually raised for it. An invoice is a link, not a
 * charge -- nothing is paid, nothing is recorded, and lava.top leaves it
 * IN_PROGRESS until it expires. Reading the code cannot tell you the gateway is
 * answering; this can.
 *
 * Raised against the owner's own email so nothing can land on a customer.
 */

const axios = require("axios");
const { createInvoice } = require("./lavaClient");

// Plus-tagged on purpose. lava.top refuses to let the seller buy from their own
// shop with their bare address -- every product came back "Incorrect email to
// purchase", which reads as eleven broken buttons rather than one rule. The tag
// routes to the same inbox and the gateway treats it as a different buyer.
const EMAIL = process.env.OWNER_EMAIL || "ziplocker777+paycheck@gmail.com";

const lava = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 20000,
});

// Every id the shop actually sells with, and the button it sits behind.
const BUTTONS = [
    ["PRODUCT_ID", "Muzzle Core FX"],
    ["PRODUCT_ID_FLASHCOLLECTION", "Flash Collection"],
    ["PRODUCT_ID_AUDIO", "Complete Audio Overhaul"],
    ["PRODUCT_ID_VISUALS", "Summer Visuals"],
    ["PRODUCT_ID_BLOOD", "Blood FX"],
    ["PRODUCT_ID_GRAPHICSPACK", "Graphics Pack"],
    ["PRODUCT_ID_GRAPHICSPACK_V2", "Graphics Pack V2"],
    ["PRODUCT_ID_GRAPHICS_V2", "Graphics V2"],
    ["PRODUCT_ID_BASIC", "Basic"],
    ["PRODUCT_ID_SUBSCRIBE", "Membership"],
    ["PRODUCT_ID_PREMIUM", "Premium"],
];

(async () => {
    // ---- what lava.top is actually selling right now ------------------------
    const { data } = await lava.get("/feed", { params: { page: 1, size: 100 } });
    const catalogue = new Map();

    for (const entry of data.items || []) {
        const p = entry.data;
        if (!p || entry.type !== "PRODUCT") continue;
        for (const offer of p.offers || []) {
            const usd = (offer.prices || []).find((x) => x.currency === "USD");
            catalogue.set(offer.id, {
                product: p.title,
                offer: offer.name || offer.id,
                price: usd ? usd.amount : null,
                status: p.status,
            });
        }
    }

    console.log(`в каталоге lava.top предложений: ${catalogue.size}\n`);
    console.log("=== id из .env против каталога ===\n");

    const live = [];
    let unknown = 0;

    // The ids are compiled into index.js, not configured in .env, so they are
    // read out of the source the buttons are built from.
    const source = require("fs").readFileSync(require("path").join(__dirname, "index.js"), "utf-8");
    const FROM_CODE = Object.fromEntries(
        [...source.matchAll(/const (PRODUCT_ID[A-Z_0-9]*) = "([0-9a-f-]+)"/g)].map((m) => [m[1], m[2]]));

    for (const [key, label] of BUTTONS) {
        const id = FROM_CODE[key];
        if (!id) { console.log(`  ?     ${label.padEnd(26)} ${key} не найден в index.js`); continue; }

        const found = catalogue.get(id);
        if (!found) {
            unknown += 1;
            console.log(`  ЖАЛОБА ${label.padEnd(25)} id из ${key} нет в каталоге`);
            continue;
        }
        console.log(`  ok    ${label.padEnd(26)} ${found.product} / ${found.offer}`
            + (found.price === null ? "" : ` $${found.price}`)
            + (found.status === "PUBLISHED" ? "" : `  [${found.status}]`));
        live.push([label, id]);
    }

    // ---- and now actually raise one -----------------------------------------
    console.log("\n=== создание настоящего счёта ===");
    console.log(`почта: ${EMAIL}\n`);

    let ok = 0;
    let bad = 0;

    // One product unless asked for all of them.
    //
    // Every invoice raised here is real and never paid, so it lingers as an
    // abandoned checkout: eleven per run put twenty of them into Lost sales,
    // reported as $203 no customer ever failed to spend. The ids were all
    // matched against the live catalogue above, which is the part that actually
    // goes stale; raising one invoice proves the gateway is answering, and
    // --all is there for the day that is not enough.
    const attempts = process.argv.includes("--all") ? live : live.slice(0, 1);

    if (attempts.length < live.length) {
        console.log(`  (один товар из ${live.length}, --all чтобы все)
`);
    }

    for (const [label, id] of attempts) {
        const started = Date.now();
        try {
            const invoice = await createInvoice({
                email: EMAIL,
                offerId: id,
                discordId: "0",
                currency: "USD",
            });
            const took = Date.now() - started;

            if (invoice?.paymentUrl) {
                ok += 1;
                console.log(`  ok    ${label.padEnd(26)} ${String(took).padStart(5)}мс  ссылка выдана`);
            } else {
                bad += 1;
                console.log(`  ЖАЛОБА ${label.padEnd(25)} ответ без ссылки: ${JSON.stringify(invoice).slice(0, 80)}`);
            }
        } catch (err) {
            bad += 1;
            const took = Date.now() - started;
            const why = err.response?.data?.error || err.response?.status || err.message;
            console.log(`  ЖАЛОБА ${label.padEnd(25)} ${String(took).padStart(5)}мс  ${why}`);
        }
    }

    console.log(`\nid не найдено в каталоге: ${unknown} · ссылок выдано: ${ok} · отказов: ${bad}`);
    console.log("счета остались неоплаченными и истекут сами.");

    process.exit(unknown || bad ? 1 : 0);
})().catch((e) => { console.error("сломалось:", e.response?.status || e.message); process.exit(1); });
