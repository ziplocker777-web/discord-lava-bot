const { isValidToken, getWatermark } = require("./watermarkStore");
const { listPresets, addPreset } = require("./presetsStore");

// Hard cap on the JSON preset payload — a real .zwp is a few KB; this is generous
// headroom while still ruling out someone trying to dump arbitrary large blobs in.
const MAX_PRESET_JSON_LENGTH = 50_000;

// Registers /presets routes on an existing Express app. Browsing is public (any
// copy of the app can list/apply community presets); submitting requires a valid
// watermark token, i.e. proof of a real purchase — see watermarkStore.js.
function registerPresetsApi(app) {
    app.get("/presets", (req, res) => {
        try {
            res.json(listPresets());
        } catch (err) {
            console.error("[presets] list failed:", err);
            res.status(500).json({ error: "Failed to list presets" });
        }
    });

    app.post("/presets", (req, res) => {
        const token = req.header("X-Watermark-Token");

        if (!isValidToken(token)) {
            console.warn(`[presets] submit rejected — invalid/missing token, ip: ${req.ip}`);
            return res.status(401).json({ error: "Invalid or missing token" });
        }

        const { name, data } = req.body || {};

        if (!name || typeof name !== "string") {
            return res.status(400).json({ error: "name is required" });
        }
        if (!data || typeof data !== "object") {
            return res.status(400).json({ error: "data is required" });
        }
        if (JSON.stringify(data).length > MAX_PRESET_JSON_LENGTH) {
            return res.status(400).json({ error: "data is too large" });
        }

        const watermark = getWatermark(token);
        const preset = addPreset({ name, data, submittedBy: watermark.discordId });

        console.log(`[presets] new submission "${preset.name}" (${preset.id}) by ${watermark.discordId}`);
        res.status(201).json({ id: preset.id });
    });
}

module.exports = { registerPresetsApi };
