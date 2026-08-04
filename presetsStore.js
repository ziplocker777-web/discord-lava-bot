const fs = require("fs");
const crypto = require("crypto");

const FILE = "./presetsStore.json";

function load() {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

function save(list) {
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// Public listing — never includes email/discordId, only what the app needs to
// show a preset in a browsing list and let the user apply it. requesterDiscordId
// (resolved from the caller's watermark token, if any) is used only to compute
// isMine per preset — never exposed itself, and never leaks anyone else's id.
function listPresets(requesterDiscordId = null) {
    return load().map(({ id, name, data, createdAt, submittedBy }) => ({
        id,
        name,
        data,
        createdAt,
        isMine: requesterDiscordId != null && submittedBy === requesterDiscordId,
    }));
}

// Full record (including submittedBy) — used only for the ownership check on delete,
// never returned to a client directly.
function getPresetById(id) {
    return load().find((p) => p.id === id) || null;
}

function addPreset({ name, data, submittedBy }) {
    const list = load();
    const preset = {
        id: crypto.randomUUID(),
        name: String(name || "Untitled").slice(0, 60),
        data,
        submittedBy, // discordId only, kept for moderation — never exposed via listPresets()
        createdAt: Date.now(),
    };
    list.push(preset);
    save(list);
    return preset;
}

function removePreset(id) {
    const list = load();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    save(next);
    return true;
}

module.exports = { listPresets, addPreset, removePreset, getPresetById };
