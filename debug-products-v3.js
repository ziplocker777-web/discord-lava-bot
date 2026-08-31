require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v3",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY }
});

(async () => {
    try {
        const { data } = await API.get("/products");
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("ERROR:", err.response?.status, JSON.stringify(err.response?.data, null, 2) || err.message);
    }
})();
