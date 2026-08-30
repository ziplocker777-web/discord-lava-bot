const { getPurchaseByLicenseKey, markActivated } = require("./watermarkStore");

// No hard multi-use limit for V1 — a shared key still unlocks the app for whoever has
// it, same tradeoff already accepted for the hidden watermark not being 100% leak-proof.
// This is a deterrent (raises the bar above "just redistribute the exe"), not a lock.
const { notifyOwner } = require("./ownerNotify");

// One message per key entry. Roughly the same volume as sales, and it confirms
// the sale actually landed: somebody who paid and never activated could not
// install it. Set NOTIFY_ACTIVATIONS=false in .env to stop them.
const NOTIFY_ACTIVATIONS = process.env.NOTIFY_ACTIVATIONS !== "false";

function registerActivateApi(app, discord) {
    app.post("/activate", (req, res) => {
        const { key } = req.body || {};

        if (!key || typeof key !== "string") {
            return res.status(400).json({ error: "key is required" });
        }

        const purchase = getPurchaseByLicenseKey(key);
        if (!purchase) {
            console.warn(`[activate] invalid key attempted — ip: ${req.ip}`);
            return res.status(401).json({ error: "Invalid license key" });
        }

        if (purchase.revoked) {
            console.warn(`[activate] revoked key attempted — discordId ${purchase.discordId}, ip: ${req.ip}`);

            // Somebody is running a build whose key was taken back. Usually a
            // lapsed subscriber who has not noticed; occasionally a key that got
            // passed around. Throttled per key, because a locked-out app can
            // retry as often as its owner presses the button.
            // Not awaited: the app is waiting on this response, and it should
            // not sit there while a Discord message is sent.
            if (discord) {
                notifyOwner(discord,
                    `**Revoked key was used**\n\n` +
                    `• ${purchase.email || "unknown"} — ${purchase.productTitle || "unknown"}\n` +
                    `• <@${purchase.discordId}>\n` +
                    `• from ${req.ip}\n\n` +
                    `Their subscription ended. Nothing to do unless you want to let them back in.`,
                    { key: `revoked-key:${purchase.licenseKey}`, cooldownMs: 12 * 60 * 60 * 1000 })
                    .catch(() => {});
            }

            return res.status(403).json({ error: "This license key has been revoked" });
        }

        // Read back rather than reused: the snapshot above was taken before this
        // activation was counted, so its number is one behind.
        const state = markActivated(purchase.token, req.ip) || { count: 0, ips: [] };
        console.log(
            `[activate] key activated for discordId ${purchase.discordId} ` +
            `(${purchase.productTitle}) — ip: ${req.ip}, ` +
            `activation ${state.count}, distinct ips: ${state.ips.length}`
        );

        if (discord && NOTIFY_ACTIVATIONS) {
            // Not awaited, for the same reason as below: the app is waiting on
            // this response and should not sit through a Discord round trip.
            notifyOwner(discord,
                `**Key activated** — ${purchase.productTitle || "unknown"}\n` +
                `• ${purchase.email || "no email"}\n` +
                `• <@${purchase.discordId}>\n` +
                `• activation ${state.count}` +
                (state.ips.length > 1 ? `, from ${state.ips.length} different addresses` : ""))
                .catch(() => {});
        }

        // Two addresses is a phone and a home connection, or an ISP handing out a
        // new one. Three separate places is where it stops looking like one
        // person's machines. Still only a nudge to go and look: the count on its
        // own has already proved misleading once.
        if (discord && state.ips.length >= 3) {
            notifyOwner(discord,
                `**A key is being used from several places**\n\n` +
                `• ${purchase.email || "unknown"} — ${purchase.productTitle || "unknown"}\n` +
                `• <@${purchase.discordId}>\n` +
                `• ${state.count} activations from ${state.ips.length} addresses\n` +
                `• ${state.ips.join(", ")}\n\n` +
                `Worth a look, not proof: mobile and home count as two. ` +
                `\`node revoke-key.js ${purchase.licenseKey}\` takes it back.`,
                { key: `spread:${purchase.licenseKey}`, cooldownMs: 24 * 60 * 60 * 1000 })
                .catch(() => {});
        }
        res.json({ valid: true, productTitle: purchase.productTitle });
    });

    // Lightweight, no-side-effect check the app makes on every startup (short timeout,
    // best-effort) to see if an ALREADY-activated key got revoked since. Deliberately
    // separate from /activate — that one bumps activationCount, and a routine startup
    // ping isn't a real activation event.
    app.get("/license-status", (req, res) => {
        const key = req.query.key;
        if (!key || typeof key !== "string") {
            return res.status(400).json({ error: "key is required" });
        }

        const purchase = getPurchaseByLicenseKey(key);
        if (!purchase) {
            return res.json({ valid: false });
        }

        res.json({ valid: !purchase.revoked });
    });
}

module.exports = { registerActivateApi };
