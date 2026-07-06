require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v3",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    }
});

// Creates an invoice on lava.top and embeds the Discord ID into clientUtm.utm_content.
// lava.top echoes clientUtm back in the payment.success webhook, so we can grant the
// role automatically without asking the user to re-enter their email after paying.
//
// paymentProvider is optional. If omitted, lava.top applies its default per currency
// (RUB -> SMART_GLOCAL, USD/EUR -> UNLIMINT). Pass "PAYPAL" explicitly for USD/EUR
// to route the payment through PayPal instead.
async function createInvoice({ email, offerId, discordId, currency = "USD", paymentProvider }) {
    const payload = {
        email,
        offerId,
        currency,
        clientUtm: {
            utm_content: discordId
        }
    };

    if (paymentProvider) {
        payload.paymentProvider = paymentProvider;
    }

    const { data } = await API.post("/invoice", payload);

    return data; // expect data.paymentUrl and data.id
}

module.exports = { createInvoice };
