require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 15000
});

const SUBSCRIPTION_PRODUCT_ID = "a7509c6c-94c6-4aa6-934c-a8788906a018";

(async () => {
    try {
        const { data } = await API.get(`/sales/${SUBSCRIPTION_PRODUCT_ID}`, {
            params: { page: 0, size: 100 }
        });
        console.log(`total: ${data.total}`);
        console.log(`Показываю ВСЕ записи без фильтра по статусу/email:\n`);
        console.log(JSON.stringify(data.items, null, 2));
    } catch (err) {
        console.error("ERROR:", err.response?.status, err.response?.data || err.message);
    }
})();
