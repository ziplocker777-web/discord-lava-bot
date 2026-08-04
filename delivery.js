const archiver = require("archiver");
const { createWatermark, getWatermark, markDownloaded } = require("./watermarkStore");

// Folder on this server holding the buyer's copy of the app (exe + Assets), same
// contents as what you'd zip up manually today. Never modified on disk — every
// download gets a fresh zip built in memory/stream with one extra file appended.
const TEMPLATE_DIR = process.env.APP_TEMPLATE_DIR;

// Public base URL this bot is reachable at, e.g. https://yourdomain.com — used to
// build the link sent to the buyer. No trailing slash.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// Deliberately bland name/location — buyers are never told this exists or what
// it's for. It just silently rides along inside their copy of the app. If a
// buyer's package ever leaks, this is what maps it back to their purchase.
const MARKER_DIR = "Assets";
const MARKER_FILENAME = ".buildinfo";

function buildDownloadUrl(token) {
    return `${PUBLIC_BASE_URL}/download/${token}`;
}

// Generates a new watermark token + license key for this purchase and returns the
// download link plus the key to show the buyer. Does not touch Discord or email —
// caller decides how to deliver it.
function deliverPurchase({ email, discordId, productId, productTitle }) {
    if (!TEMPLATE_DIR || !PUBLIC_BASE_URL) {
        throw new Error("APP_TEMPLATE_DIR and PUBLIC_BASE_URL must be set in .env for automatic delivery.");
    }
    const { token, licenseKey } = createWatermark({ email, discordId, productId, productTitle });
    return { downloadUrl: buildDownloadUrl(token), licenseKey };
}

// Streams a fresh zip of TEMPLATE_DIR into res, with the hidden marker file
// injected. Returns false (and sends its own 404) if the token is unknown.
function streamWatermarkedPackage(res, token) {
    const record = getWatermark(token);
    if (!record) return false;

    res.attachment("Muzzle Core Configurator.zip");

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
        console.error(`[delivery] archive error for token ${token}:`, err);
        res.destroy(err);
    });
    archive.pipe(res);

    archive.directory(TEMPLATE_DIR, false);
    archive.append(JSON.stringify({ id: token }), { name: `${MARKER_DIR}/${MARKER_FILENAME}` });

    archive.finalize();
    markDownloaded(token);
    return true;
}

module.exports = { deliverPurchase, streamWatermarkedPackage, buildDownloadUrl };
