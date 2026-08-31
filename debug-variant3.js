require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v2",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY }
});

const PRODUCT_ID = "24ad821c-8819-4643-8d24-64c309d27970"; // из URL app.lava.top/products/{id}/content

(async () => {
    try {
        const { data } = await API.get(`/products/${PRODUCT_ID}`);
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("ERROR:", err.response?.status, err.response?.data || err.message);
    }
})();
