require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v3",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY,
        "Content-Type": "application/json"
    }
});

// Настоящий offerId оффера Variant III (из offers[].id, не id продукта).
const OFFER_ID = "c993d7c1-fe58-4ea6-9cdb-6b9f0128edc2";

(async () => {
    try {
        const { data } = await API.post("/invoice", {
            email: "test@example.com",
            offerId: OFFER_ID,
            currency: "USD",
            amount: 2.99
        });
        console.log("УСПЕХ — offerId рабочий:");
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("ОШИБКА:", err.response?.status, JSON.stringify(err.response?.data, null, 2) || err.message);
    }
})();
