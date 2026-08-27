require("./env.js").loadEnv();

/**
 * Asks lava.top directly what the subscription sales look like.
 *
 * Written because the webhook stream cannot answer it. In two months of logs
 * there is not a single renewal event: every real customer with more than one
 * payment bought different products, and `parentContractId` -- the field a
 * renewal is supposed to carry -- appears exactly once in the whole log, inside a
 * test payload. So either lava.top does not send renewals to the webhook, or none
 * has happened yet, and the webhook cannot tell us which.
 *
 * Anything that revokes a role for non-payment has to read from here instead.
 * Revoking on webhook silence would strip the role from every paying subscriber.
 *
 *   node check-subs.js
 */

const axios = require("axios");

const SUBSCRIPTION_PRODUCT_ID = "a7509c6c-94c6-4aa6-934c-a8788906a018";

const api = axios.create({
    // v1 is where /sales lives — the same client findCompletedSaleByEmail uses.
    // v3 creates invoices, v2 lists offer prices; neither answers this.
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 20000,
});

function mask(e) {
    if (!e || !e.includes("@")) return e || "-";
    return e.slice(0, 2) + "***@" + e.split("@").pop();
}

(async () => {
    let items = [];
    try {
        const { data } = await api.get(`/sales/${SUBSCRIPTION_PRODUCT_ID}`, {
            params: { page: 0, size: 100 },
        });
        items = data.items || [];
    } catch (err) {
        console.error("lookup failed:", err.response?.status, err.response?.data || err.message);
        process.exit(1);
    }

    console.log(`subscription sales returned: ${items.length}\n`);

    // Grouped by contract: if renewals appear here at all, one contract will carry
    // several sales with different dates. That is the whole question.
    const byContract = new Map();
    for (const it of items) {
        const key = it.contractId || "(no contract)";
        if (!byContract.has(key)) byContract.set(key, []);
        byContract.get(key).push(it);
    }

    const offers = new Map();
    for (const it of items) offers.set(it.id, (offers.get(it.id) || 0) + 1);

    console.log("offer ids seen (this is the exact tier signal):");
    for (const [id, n] of offers) console.log(`  ${id}  x${n}`);

    console.log("\ncontracts with more than one sale (i.e. renewals):");
    let renewals = 0;
    for (const [cid, sales] of byContract) {
        if (sales.length < 2) continue;
        renewals += 1;
        sales.sort((a, b) => String(a.created).localeCompare(String(b.created)));
        console.log(`  ${cid}`);
        for (const s of sales) {
            console.log(`     ${String(s.created).slice(0, 19)}  ${s.status}  ` +
                `${s.amountTotal?.amount} ${s.amountTotal?.currency}  ${mask(s.buyer?.email)}`);
        }
    }
    if (!renewals) console.log("  none — every contract has exactly one sale");

    console.log("\nmost recent sales:");
    const sorted = [...items].sort((a, b) => String(b.created).localeCompare(String(a.created)));
    for (const s of sorted.slice(0, 12)) {
        console.log(`  ${String(s.created).slice(0, 19)}  ${String(s.status).padEnd(10)} ` +
            `${String(s.amountTotal?.amount).padStart(6)} ${s.amountTotal?.currency}  ` +
            `${mask(s.buyer?.email)}  offer ${String(s.id).slice(0, 8)}  contract ${String(s.contractId).slice(0, 8)}`);
    }
})();
