/**
 * Every admin command must be locked to administrators.
 *
 * The gate is not in this bot's code: handleAdminCommand runs whatever it is
 * given. The only thing standing between a curious member and a list of
 * customer email addresses is setDefaultMemberPermissions on the command
 * registration, so a command added to HANDLERS and registered without it is
 * open to the whole server and nothing would say so.
 *
 * Compares the two lists and complains about anything in the first that is not
 * locked in the second.
 */

const fs = require("fs");
const path = require("path");

const here = (f) => path.join(__dirname, f);

const admin = fs.readFileSync(here("adminCommands.js"), "utf-8");
const deploy = fs.readFileSync(here("deploy-commands.js"), "utf-8");

// The HANDLERS table: everything handleAdminCommand will answer to.
const table = admin.match(/const HANDLERS = \{([\s\S]*?)\n\};/);
if (!table) throw new Error("HANDLERS не найден в adminCommands.js");

const handlers = [...table[1].matchAll(/^\s*([a-z][a-z0-9]*)\s*[,:]/gim)].map((m) => m[1]);

// Each registered command, and whether its registration carries the lock.
const blocks = deploy.split("new SlashCommandBuilder()").slice(1);
const registered = new Map();
for (const b of blocks) {
    const name = b.match(/\.setName\("([^"]+)"\)/);
    if (!name) continue;
    registered.set(name[1], b.includes("setDefaultMemberPermissions"));
}

console.log(`команд в HANDLERS: ${handlers.length} · зарегистрировано: ${registered.size}\n`);

let open = 0;
let missing = 0;

for (const name of handlers.sort()) {
    if (!registered.has(name)) {
        missing += 1;
        console.log(`  ?      /${name.padEnd(18)} есть обработчик, но команда не зарегистрирована`);
        continue;
    }
    if (!registered.get(name)) {
        open += 1;
        console.log(`  ЖАЛОБА /${name.padEnd(18)} ОТКРЫТА ВСЕМ — нет setDefaultMemberPermissions`);
        continue;
    }
    console.log(`  ok     /${name.padEnd(18)} только администраторам`);
}

// The other direction: something locked but with nobody to answer it is only
// untidy, while something registered openly that reaches an admin handler is not.
const orphans = [...registered.keys()].filter((n) => !handlers.includes(n));
if (orphans.length) console.log(`\nзарегистрированы, но не админские: ${orphans.join(", ")}`);

console.log(`\nоткрыто всем: ${open} · без регистрации: ${missing}`);
process.exit(open ? 1 : 0);
