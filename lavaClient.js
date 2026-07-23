require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v3",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    }
});

// Отмена подписки использует другую версию API (v1), сам инвойс создаётся на v3.
const API_V1 = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
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

// Отменяет подписку на lava.top.
// contractId здесь — это parentContractId: contractId ПЕРВОГО успешного
// платежа по подписке. Он не меняется при последующих списаниях, поэтому
// его достаточно один раз сохранить при первом payment.success вебхуке
// (см. webhookServer.js -> purchaseStore, поле contractId).
async function cancelSubscription({ contractId, email }) {
    const { data } = await API_V1.delete("/subscriptions", {
        params: { contractId, email }
    });

    return data;
}

module.exports = { createInvoice, cancelSubscription };
