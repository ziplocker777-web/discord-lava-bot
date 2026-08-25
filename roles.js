// Product id of the "Subscription ziplocker" product on lava.top
// (the top-level product id, NOT the offer id used for invoice creation).
const SUBSCRIPTION_PRODUCT_ID = "a7509c6c-94c6-4aa6-934c-a8788906a018";

// ---------------------------------------------------------------------------
// SUBSCRIPTION TIERS
// ---------------------------------------------------------------------------
// All three tiers are OFFERS of that ONE product, so every tier arrives on the
// webhook carrying the SAME product.id. Verified against a real payload in the
// server log (2026-08-22): the body has eventType, product{id,title}, contractId,
// buyer{email}, amount, currency, timestamp, status, clientUtm — and no offer id
// anywhere. So the tier has to be recovered from what the payment was FOR, and
// the only field that differs between tiers is the amount.
//
// The manual paths (/getrole, manual-deliver, add-refund) are better off: the
// /sales endpoint returns the offerId as item.id, which is exact. Both routes
// feed resolveSubscriptionTier below — offerId wins when it is available.
//
// prices are the reference amounts read from GET /api/v2/products on 2026-08-25.
// USD is the currency the tiers are actually priced in; lava.top derives RUB and
// EUR from it and re-derives them as the rate moves, so those two drift. Matching
// is therefore nearest-by-relative-distance rather than equality — with the tiers
// 67% and 50% apart, a few percent of FX drift can never reach the neighbour.
const TIERS = [
    {
        key: "basic",
        label: "Basic",
        offerId: "82093c36-a7fd-42f6-9ede-6ac29adcbc34",
        roleEnv: "BASIC_ROLE_ID",
        // Basic has its own downloads channel: what it covers is a subset of what the
        // other two get, so pointing it at the shared channel would show a Basic member
        // a wall of files they cannot open.
        channelEnv: "BASIC_CHANNEL_ID",
        // The Basic tier deliberately excludes Muzzle Core FX, so it must NOT
        // receive the watermarked configurator package the other two tiers get.
        includesConfigurator: false,
        prices: { USD: 5.99, RUB: 502.25, EUR: 5.14 },
    },
    {
        key: "membership",
        label: "Membership",
        offerId: "fd9076bc-1285-4fa5-a55d-86657ad32ab5",
        roleEnv: "SUBSCRIBE_ROLE_ID",
        channelEnv: "SUBSCRIBER_CHANNEL_ID",
        includesConfigurator: true,
        prices: { USD: 9.99, RUB: 837.64, EUR: 8.57 },
    },
    {
        key: "premium",
        label: "Premium",
        offerId: "d1fa96bf-b9c3-42db-ab5d-53749b4f0f07",
        roleEnv: "PREMIUM_ROLE_ID",
        // Premium reads the same downloads channel as Membership; what it adds is beta
        // builds and early access, not a separate library.
        channelEnv: "SUBSCRIBER_CHANNEL_ID",
        includesConfigurator: true,
        prices: { USD: 14.99, RUB: 1256.88, EUR: 12.85 },
    },
];

// How far a paid amount may sit from a tier's reference price and still count as
// that tier. The tiers are 67% and 50% apart, so this leaves a wide dead zone
// between them: an amount that isn't clearly one tier is reported rather than
// guessed at, because guessing wrong hands out a paid role for free. It only has
// to absorb FX drift in the first place when the startup price refresh below
// failed and the compiled table is being used.
const MAX_PRICE_DRIFT = 0.15;

const TIERS_BY_KEY = new Map(TIERS.map((t) => [t.key, t]));
const TIERS_BY_OFFER = new Map(TIERS.map((t) => [t.offerId, t]));

/**
 * Works out which subscription tier a purchase is, from whatever the caller has.
 * Returns a tier object, or null when this isn't the subscription product or the
 * tier can't be established.
 *
 * offerId is exact and is used alone when present. tier is the key we stored on
 * the purchase record at webhook time. amount/currency is the webhook's only clue.
 */
function resolveSubscriptionTier(purchase = {}) {
    const { offerId, tier, amount, currency } = purchase;

    // Webhook events nest it as product.id; stored purchase records keep it flat as
    // productId. Both shapes reach this function, so both are read.
    const productId = purchase.productId || purchase.product?.id;

    if (offerId && TIERS_BY_OFFER.has(offerId)) return TIERS_BY_OFFER.get(offerId);
    if (tier && TIERS_BY_KEY.has(tier)) return TIERS_BY_KEY.get(tier);

    if (productId !== SUBSCRIPTION_PRODUCT_ID) return null;
    if (typeof amount !== "number" || !Number.isFinite(amount) || !currency) return null;

    const cur = String(currency).toUpperCase();
    let best = null;
    let bestDrift = Infinity;

    for (const candidate of TIERS) {
        const reference = candidate.prices[cur];
        if (!reference) continue;
        const drift = Math.abs(amount - reference) / reference;
        if (drift < bestDrift) {
            bestDrift = drift;
            best = candidate;
        }
    }

    if (!best || bestDrift > MAX_PRICE_DRIFT) {
        console.warn(
            `[roles] subscription payment of ${amount} ${cur} matches no known tier` +
            (best ? ` (closest: ${best.key}, off by ${(bestDrift * 100).toFixed(1)}%)` : "") +
            " — tier role not granted, handle this one by hand."
        );
        return null;
    }

    return best;
}

/**
 * Replaces the compiled reference prices with the live ones from lava.top, keyed by
 * offer id. Called once at startup; a failure is not fatal, the compiled table just
 * stays in use. Returns the number of tiers updated.
 */
function applyLivePrices(pricesByOfferId) {
    if (!pricesByOfferId) return 0;

    let updated = 0;
    for (const tier of TIERS) {
        const live = pricesByOfferId[tier.offerId];
        if (!live || typeof live.USD !== "number") continue;
        tier.prices = live;
        updated++;
    }
    return updated;
}

// The channel a tier's downloads are posted in, or null when none is configured.
function tierDownloadsChannelId(tier) {
    if (!tier || !tier.channelEnv) return null;
    return process.env[tier.channelEnv] || null;
}

// Every tier role we know about, for stripping the previous tier on an upgrade or
// downgrade. Filtered because a tier whose env var isn't set has no role to strip.
function getAllTierRoleIds() {
    return TIERS.map((t) => process.env[t.roleEnv]).filter(Boolean);
}

/**
 * Discord role ids to grant for a purchase.
 *
 * ROLE_ID is the base "customers" role and is granted for every purchase; the
 * tier role is added on top for the subscription product.
 *
 * `purchase` is either a webhook event or a stored purchase record — see
 * resolveSubscriptionTier for the fields it can use.
 */
function getRolesForPurchase(purchase) {
    const roles = [];

    if (process.env.ROLE_ID) roles.push(process.env.ROLE_ID);

    const tier = resolveTierWithLegacyFallback(purchase);
    if (tier && process.env[tier.roleEnv]) roles.push(process.env[tier.roleEnv]);

    return roles;
}

/**
 * Purchase records written before the tiers existed (2026-08-25) carry only a
 * productId — no offerId, no amount, no tier. Every one of those is the old
 * single $9.99 Membership, because that was the only subscription on sale, so
 * they resolve to Membership rather than being dropped on the floor.
 */
function resolveTierWithLegacyFallback(purchase) {
    const resolved = resolveSubscriptionTier(purchase || {});
    if (resolved) return resolved;

    const p = purchase || {};
    const productId = p.productId || p.product?.id;
    const noTierEvidence = !p.offerId && !p.tier && typeof p.amount !== "number";
    if (productId === SUBSCRIPTION_PRODUCT_ID && noTierEvidence) {
        return TIERS_BY_KEY.get("membership");
    }

    return null;
}

// Backwards-compatible shim for the call sites that only ever have a product id.
function getRolesForProduct(productId) {
    return getRolesForPurchase({ productId });
}

/**
 * Roles to REMOVE when a subscription is cancelled / a recurring payment finally
 * fails. ROLE_ID (the base "customers" role) is deliberately kept — the person
 * still made a past purchase, only the active subscription perk goes away.
 *
 * When the cancellation event identifies its tier, only that tier's role is
 * stripped: lava.top fires a cancellation for the old plan when someone switches
 * plans, and blanket-revoking would take away the tier they just moved to.
 * With no usable tier, all of them go — better a member who has to re-verify
 * than one who keeps paid access for free.
 */
function getRolesToRevokeOnCancellation(purchase) {
    const tier = resolveTierWithLegacyFallback(purchase);

    if (tier) {
        const roleId = process.env[tier.roleEnv];
        return roleId ? [roleId] : [];
    }

    return getAllTierRoleIds();
}

module.exports = {
    applyLivePrices,
    tierDownloadsChannelId,
    getRolesForProduct,
    getRolesForPurchase,
    getRolesToRevokeOnCancellation,
    resolveSubscriptionTier,
    resolveTierWithLegacyFallback,
    getAllTierRoleIds,
    SUBSCRIPTION_PRODUCT_ID,
    TIERS,
};
