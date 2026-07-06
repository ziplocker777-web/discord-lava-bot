require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    }
});

const products = {
    "Ziplocker Summer Visuals": "f653e37f-59aa-4ba7-825a-53551a57f960",
    "Ziplocker Plus (Subscription)": "7303df31-6320-42c3-bd55-0a7d6a03051f",
    "Muzzle Core FX": "8f45204c-0a4f-4912-ada0-f822705ca301",
};

(async () => {
    for (const [name, id] of Object.entries(products)) {
        try {
            const { data } = await API.get(`/sales/${id}`, { params: { page: 0, size: 50 } });
            console.log(`\n=== ${name} (${id}) — total: ${data.total} ===`);
            console.log(JSON.stringify(data.items, null, 2));
        } catch (err) {
            console.error(`\n=== ${name} (${id}) — ERROR ===`, err.response?.status, err.response?.data || err.message);
        }
    }
})();