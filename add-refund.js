require("dotenv").config();
const { addRefund } = require("./refundedEmails");

const EMAIL = process.argv[2];

if (!EMAIL) {
    console.error("Использование: node add-refund.js email@example.com");
    process.exit(1);
}

addRefund(EMAIL);
console.log(`Добавлено в refundedEmails.json: ${EMAIL.trim().toLowerCase()}`);
console.log("Не забудьте вручную снять роль у этого пользователя в Discord, если ещё не сняли.");
