const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { createWatermark, getWatermark, markDownloaded } = require("./watermarkStore");
const { SUBSCRIPTION_PRODUCT_ID } = require("./roles");

// Folder on this server holding the buyer's copy of the app (exe + Assets), same
// contents as what you'd zip up manually today. Never modified on disk — every
// download gets a fresh zip built in memory/stream with one extra file appended.
const TEMPLATE_DIR = process.env.APP_TEMPLATE_DIR;

// Public base URL this bot is reachable at, e.g. https://yourdomain.com — used to
// build the link sent to the buyer. No trailing slash.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// Both the folder inside the zip AND the zip's own filename — bump this on release so
// buyers who unzip end up with a clearly-versioned folder instead of files loose in
// whatever directory they extracted into.
const PACKAGE_NAME = "Muzzle Core Configurator v2.2";

// Buyers are never told either of these exists or what they're for. If a buyer's
// package ever leaks, these are what map it back to their purchase.
//
// TWO copies of the same token, by design:
//
// 1. DECOY — a lone dot-prefixed file at the top of Assets\. Obvious enough that
//    anyone technical who goes looking for "the tracker" finds this first — deleting
//    it feels like a win, so that's where the search stops.
// 2. REAL — the same token appended as trailing bytes after v1's preview.mp4 (ships
//    to every buyer, even free users). Someone who stripped the decoy above has no
//    reason left to suspect a video file, so this one survives.
//
// Safe specifically BECAUSE preview.mp4 is only ever played back via the app's own
// MediaElement preview — never touched by ApplyTextures/the build pipeline the way
// preset textures are (those get copied byte-for-byte into the compiled .rpf itself,
// so corrupting one is not an option). MP4 players read strictly by each atom's
// declared size, not "to EOF", so trailing bytes after the real video data are
// silently ignored.
const DECOY_MARKER_DIR = "Assets";
const DECOY_MARKER_FILENAME = ".buildinfo";
const REAL_MARKER_HOST_REL = "Assets/Presets/v1/preview.mp4";
const REAL_MARKER_DELIMITER = "\n<<ZWMK>>";

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
    const { token, licenseKey, isNew } = createWatermark({ email, discordId, productId, productTitle });
    return { downloadUrl: buildDownloadUrl(token), licenseKey, isNew };
}

// Shared DM copy for every delivery path (webhook, /getrole, /panelredownload, manual
// admin delivery) — the subscription's raw product title ("Subscription ziplocker")
// isn't what's actually being downloaded, so it gets its own explanation instead of
// just printing the title, plus a pointer to the channel with the rest of its mods.
function buildDeliveryMessage({ productId, productTitle, downloadUrl, licenseKey, greeting = "Thanks for your purchase!" }) {
    const isSubscription = productId === SUBSCRIPTION_PRODUCT_ID;

    const intro = isSubscription
        ? `${greeting}\n\nYour membership includes the **Muzzle Core Configurator** — the tool for customizing muzzle flash, sparks, smoke, tracers and bullet impacts:\n${downloadUrl}`
        : `${greeting}\n\n**${productTitle || "Your download"}**\n${downloadUrl}`;

    const channelNote = isSubscription
        ? (process.env.SUBSCRIBER_CHANNEL_ID
            ? `\n\nAlso check out <#${process.env.SUBSCRIBER_CHANNEL_ID}> — that's where the rest of the mods included in your membership are posted.`
            : "\n\nAlso check out your subscriber channel — that's where the rest of the mods included in your membership are posted.")
        : "";

    return `${intro}\n\n` +
        `Your license key (enter this in the app to unlock it):\n\`${licenseKey}\`\n\n` +
        `This link and key are tied to your order — please don't share them.${channelNote}`;
}

// Streams a fresh zip of TEMPLATE_DIR into res, with both the decoy and the real
// hidden marker injected. Returns false (and sends its own 404) if the token is unknown.
function streamWatermarkedPackage(res, token) {
    const record = getWatermark(token);
    if (!record) return false;

    res.attachment(`${PACKAGE_NAME}.zip`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
        console.error(`[delivery] archive error for token ${token}:`, err);
        res.destroy(err);
    });
    archive.pipe(res);

    const realHostPath = path.join(TEMPLATE_DIR, REAL_MARKER_HOST_REL);
    const realHostExists = fs.existsSync(realHostPath);

    if (realHostExists) {
        // Skip the plain copy of the real marker's host file — appended below with
        // the token baked in, so there isn't also an unmarked duplicate in the zip.
        archive.directory(TEMPLATE_DIR, PACKAGE_NAME, (entry) =>
            entry.name === REAL_MARKER_HOST_REL ? false : entry
        );

        const markedBuffer = Buffer.concat([
            fs.readFileSync(realHostPath),
            Buffer.from(REAL_MARKER_DELIMITER + JSON.stringify({ id: token }), "utf-8"),
        ]);
        archive.append(markedBuffer, { name: `${PACKAGE_NAME}/${REAL_MARKER_HOST_REL}` });
    } else {
        // Host file missing from this template (shouldn't happen) — still ship the
        // decoy below rather than fail the whole delivery.
        console.error(`[delivery] real marker host missing at ${realHostPath} — only the decoy will be present for token ${token}`);
        archive.directory(TEMPLATE_DIR, PACKAGE_NAME);
    }

    archive.append(JSON.stringify({ id: token }), { name: `${PACKAGE_NAME}/${DECOY_MARKER_DIR}/${DECOY_MARKER_FILENAME}` });

    archive.finalize();
    markDownloaded(token);
    return true;
}

module.exports = { deliverPurchase, streamWatermarkedPackage, buildDownloadUrl, buildDeliveryMessage };
