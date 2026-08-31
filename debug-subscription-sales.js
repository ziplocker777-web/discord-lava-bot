require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    }
});

// ВАЖНО: это подтверждённый по реальным вебхукам id продукта "Subscription
// ziplocker" (a7509c6c-...), а не тот, что был в старом debug-all-products.js
// (7303df31-... — судя по всему, устаревший/другой продукт).
const SUBSCRIPTION_PRODUCT_ID = "a7509c6c-94c6-4aa6-934c-a8788906a018";
const TARGET_EMAIL = "jstainsby09@gmail.com"; // поменяйте при необходимости

(async () => {
    try {
        const { data } = await API.get(`/sales/${SUBSCRIPTION_PRODUCT_ID}`, { params: { page: 0, size: 100 } });
        console.log(`\n=== Subscription ziplocker (${SUBSCRIPTION_PRODUCT_ID}) — total: ${data.total} ===`);

        const match = (data.items || []).filter(
            (item) => (item.buyer?.email || item.email || "").toLowerCase() === TARGET_EMAIL.toLowerCase()
        );

        if (match.length === 0) {
            console.log(`Ничего не найдено по email ${TARGET_EMAIL}. Вот последние 10 записей для сверки:`);
            console.log(JSON.stringify((data.items || []).slice(0, 10), null, 2));
        } else {
            console.log(`Найдено ${match.length} запись(ей) по email ${TARGET_EMAIL}:`);
            console.log(JSON.stringify(match, null, 2));
        }
    } catch (err) {
        console.error(`ERROR:`, err.response?.status, err.response?.data || err.message);
    }
})();