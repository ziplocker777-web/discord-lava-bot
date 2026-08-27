/**
 * Loads .env and makes it win.
 *
 * dotenv never overwrites a variable that is already present in the environment.
 * That is a sensible default for deployments, and it is also how this bot spent
 * an evening answering nothing at all: the shell it was launched from exported
 * ANTHROPIC_BASE_URL=https://api.anthropic.com for its own reasons, .env was
 * quietly skipped for that one line, and every request went to Anthropic itself
 * carrying a tw-live- gateway key. Anthropic rejects that key, so the model never
 * answered — and from Discord it looked exactly like the bot ignoring people.
 *
 * The tell was in the startup banner all along: "injected env (18)" where every
 * healthy run says 19.
 *
 * Which endpoint this bot talks to is not ambient configuration that a terminal
 * gets to decide. It belongs to the bot, it lives in .env, and .env wins.
 *
 * Deliberately narrow: only the keys listed here are forced. Everything else
 * keeps dotenv's normal behaviour, so a genuine deployment override still works.
 */

const dotenv = require("dotenv");

// Settings that must come from this project's own .env, never from whatever
// happens to be exported in the shell.
const OWNED_BY_DOTENV = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
];

let applied = false;

function loadEnv() {
    const result = dotenv.config({ quiet: true });
    const fromFile = result.parsed || {};

    for (const key of OWNED_BY_DOTENV) {
        if (!fromFile[key]) continue;
        if (process.env[key] === fromFile[key]) continue;

        // Worth a line in the log: a value being overridden here means something
        // outside the project was trying to redirect the bot, and if the endpoint
        // is ever wrong again this is the first place to look.
        if (!applied && process.env[key]) {
            console.warn(
                `[env] ${key} was set in the environment; using the value from .env instead`
            );
        }
        process.env[key] = fromFile[key];
    }

    applied = true;
    return fromFile;
}

module.exports = { loadEnv, OWNED_BY_DOTENV };
