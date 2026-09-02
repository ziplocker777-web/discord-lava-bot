const fs = require("fs");
const path = require("path");

/**
 * Reading and writing the JSON files this bot keeps its life in.
 *
 * Every store used to call fs.writeFileSync straight onto the live file. That is
 * not atomic: a process that dies partway through -- an out-of-memory kill, a
 * pm2 restart landing at the wrong moment, the machine rebooting, which it did
 * at 01:51 on 2026-09-02 -- leaves the file truncated.
 *
 * And truncated is the dangerous state, because every loader here is written as
 * `try { JSON.parse(...) } catch { return {} }`. A half-written purchaseStore
 * would not raise anything. It would come back as an empty object, the bot would
 * carry on serving nobody, and the only sign would be customers saying /getrole
 * had stopped finding their purchase.
 *
 * Written to a sibling temp file and renamed instead. rename(2) is atomic on the
 * same filesystem, so a reader sees either the whole old file or the whole new
 * one, and a crash at any instant leaves one of the two rather than neither.
 */

/** @returns the parsed file, or `fallback` if it is missing or unreadable */
function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
        if (err.code !== "ENOENT") {
            // Worth saying out loud. A parse error here means the file on disk is
            // damaged, and returning the fallback silently is how that goes
            // unnoticed until somebody's purchase cannot be found.
            console.error(`[store] ${path.basename(file)} could not be read (${err.message}) — using the fallback`);
        }
        return fallback;
    }
}

/** Replace a JSON file in one step, or not at all. */
function writeJson(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson };
