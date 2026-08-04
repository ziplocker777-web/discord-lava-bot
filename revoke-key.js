const { setRevoked } = require("./watermarkStore");

const KEY = process.argv[2];
const ACTION = (process.argv[3] || "revoke").toLowerCase();

if (!KEY) {
    console.error("Использование: node revoke-key.js LICENSE-KEY [revoke|unrevoke]");
    process.exit(1);
}

const revoked = ACTION !== "unrevoke";
const found = setRevoked(KEY, revoked);

if (!found) {
    console.error(`Ключ "${KEY}" не найден в watermarkStore.json.`);
    process.exit(1);
}

console.log(revoked
    ? `Ключ ${KEY} отозван — при следующем запуске (если приложение online) сбросит активацию.`
    : `Ключ ${KEY} восстановлен.`);
