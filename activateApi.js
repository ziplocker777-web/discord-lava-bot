const { getPurchaseByLicenseKey, markActivated } = require("./watermarkStore");

// No hard multi-use limit for V1 — a shared key still unlocks the app for whoever has
// it, same tradeoff already accepted for the hidden watermark not being 100% leak-proof.
// This is a deterrent (raises the bar above "just redistribute the exe"), not a lock.
function registerActivateApi(app) {
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

        markActivated(purchase.token);
        console.log(`[activate] key activated for discordId ${purchase.discordId} (${purchase.productTitle})`);
        res.json({ valid: true, productTitle: purchase.productTitle });
    });
}

module.exports = { registerActivateApi };
