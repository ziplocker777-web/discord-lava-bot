require("dotenv").config();
const axios = require("axios");

const API = axios.create({
    baseURL: "https://gate.lava.top/api/v3",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    },
    timeout: 10000
});

// Отмена подписки использует другую версию API (v1), сам инвойс создаётся на v3.
const API_V1 = axios.create({
    baseURL: "https://gate.lava.top/api/v1",
    headers: {
        "X-Api-Key": process.env.LAVA_API_KEY
    },
    timeout: 10000
});

// Ретрай только для read-запросов (GET /sales). НЕ применяется к createInvoice
// или cancelSubscription — там повтор после таймаута может задвоить инвойс
// или отправить лишний DELETE, поэтому те остаются без ретрая.
async function getWithRetry(url, config, retries = 1) {
    try {
        return await API_V1.get(url, config);
    } catch (err) {
        if (retries <= 0) throw err;
        return getWithRetry(url, config, retries - 1);
    }
}

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
// "new" — подтверждённый статус успешной продажи ПОДПИСКИ в этом эндпоинте
// (пример: lapha97@mail.ru, 100% промокод, $0, статус "new", но по факту
// активная подписка) — не путать с "ожидает оплаты", тут это конечный статус успеха.
const COMPLETED_STATUSES = ["completed", "success", "paid", "active", "new"];

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
    const entries = Object.entries(KNOWN_PRODUCT_IDS);

    // Запросы по всем продуктам идут параллельно (не по одному последовательно) —
    // при 7 продуктах это разница между ~1 таймаутом и ~7 таймаутами, если lava.top
    // подвисает. Каждый запрос — с 1 ретраем на случай единичного сетевого сбоя.
    const results = await Promise.allSettled(
        entries.map(([title, productId]) =>
            getWithRetry(`/sales/${productId}`, { params: { page: 0, size: 100 } }).then(
                ({ data }) => ({ title, productId, data })
            )
        )
    );

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const [title, productId] = entries[i];

        if (result.status === "rejected") {
            const err = result.reason;
            console.error(
                `findCompletedSaleByEmail: lookup failed for ${title} (${productId}):`,
                err.response?.status,
                err.response?.data || err.message
            );
            continue; // Продолжаем проверять остальные продукты, даже если один запрос упал.
        }

        const { data } = result.value;
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
                // The subscription tiers are three offers of one product, so the product
                // id alone can't say which one this is. item.id here is the OFFER id,
                // which can - it's the only exact tier signal anywhere in the API.
                offerId: match.id || null,
                amount: match.amountTotal?.amount,
                currency: match.amountTotal?.currency,
            };
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

// Reads the live per-currency price of every offer on a product. The subscription
// tiers are priced in USD and lava.top derives RUB and EUR from that, re-deriving
// them as the rate moves — so the reference prices compiled into roles.js go stale
// on their own. Pulling them at startup keeps tier detection matching what buyers
// are actually charged; roles.js falls back to its compiled table if this fails.
//
// v2 rather than v3: /products only exists on v2 (v3 answers 404).
const API_V2 = axios.create({
    baseURL: "https://gate.lava.top/api/v2",
    headers: { "X-Api-Key": process.env.LAVA_API_KEY },
    timeout: 15000,
});

async function fetchOfferPrices(productId) {
    const { data } = await API_V2.get("/products");
    const items = data.items || data || [];

    for (const item of items) {
        const product = item.data || item;
        if (product.id !== productId) continue;

        const byOffer = {};
        for (const offer of product.offers || []) {
            const prices = {};
            for (const price of offer.prices || []) {
                if (price.currency && typeof price.amount === "number") {
                    prices[String(price.currency).toUpperCase()] = price.amount;
                }
            }
            if (Object.keys(prices).length > 0) byOffer[offer.id] = prices;
        }
        return byOffer;
    }

    return null;
}

module.exports = { createInvoice, cancelSubscription, findCompletedSaleByEmail, fetchOfferPrices };

