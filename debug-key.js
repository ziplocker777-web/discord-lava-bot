require("dotenv").config();
const axios = require("axios");

const key = process.env.LAVA_API_KEY || "";

console.log("Key loaded:", key ? `yes, length ${key.length}, starts with "${key.slice(0, 4)}..."` : "NO — LAVA_API_KEY is empty/undefined!");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v2",
    headers: {
        "X-Api-Key": key
    }
});

(async () => {
    try {
        const { data } = await API.get("/products");
        console.log("Products visible to this key:");
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Request failed:", err.response?.status, err.response?.data || err.message);
    }
})();