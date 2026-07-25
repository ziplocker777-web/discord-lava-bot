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

const KNOWN_PRODUCT_IDS = require("./products");

// Статусы, которые lava.top отдаёт в /sales для успешно завершённых продаж.
// "completed" видели в реальных вебхуках; "success"/"paid"/"active" добавлены
// на всякий случай (для подписок статус может отличаться от разовых покупок).
const COMPLETED_STATUSES = ["completed", "success", "paid", "active"];

// Фоллбек для /getrole на случай, когда в purchaseStore.json нет записи
// (например, покупка была сделана напрямую на сайте lava.top в обход бота,
// и webhook либо не пришёл, либо не содержал clientUtm с discordId).
//
// Проходит по всем известным продуктам (см. products.js) и ищет завершённую
// продажу с этим email. Возвращает null, если ничего не нашлось ни в одном
// продукте, либо объект с данными продажи.
//
// ВНИМАНИЕ: /sales в нашем тестировании не возвращает contractId — то есть
// для найденной таким образом подписки может не быть contractId, нужного
// для cancelSubscription(). Это нормально: как только придёт первый
// нормальный webhook (например при продлении), contractId допишется.
async function findCompletedSaleByEmail(email) {
    const target = email.trim().toLowerCase();

    for (const [title, productId] of Object.entries(KNOWN_PRODUCT_IDS)) {
        try {
            const { data } = await API_V1.get(`/sales/${productId}`, {
                params: { page: 0, size: 100 },
            });

            const match = (data.items || []).find((item) => {
                const buyerEmail = (item.buyer?.email || "").trim().toLowerCase();
                const status = (item.status || "").trim().toLowerCase();
                return buyerEmail === target && COMPLETED_STATUSES.includes(status);
            });

            if (match) {
                return {
                    productId: match.product?.id || productId,
                    productTitle: match.product?.name || title,
                    status: match.status,
                    created: match.created,
                    contractId: match.contractId || null,
                };
            }
        } catch (err) {
            console.error(
                `findCompletedSaleByEmail: lookup failed for ${title} (${productId}):`,
                err.response?.status,
                err.response?.data || err.message
            );
            // Продолжаем проверять остальные продукты, даже если один запрос упал.
        }
    }

    return null;
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

module.exports = { createInvoice, cancelSubscription, findCompletedSaleByEmail };
