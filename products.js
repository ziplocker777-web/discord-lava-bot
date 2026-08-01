// Единый список top-level PRODUCT id (НЕ offerId!) для запросов к
// /sales/{productId}. Используется findCompletedSaleByEmail в lavaClient.js
// как фоллбек для /getrole.
//
// Получено напрямую из GET /api/v2/products (см. debug-key.js) —
// это официальный список продуктов аккаунта, самый надёжный источник.
// Дата сверки: 2026-07-25.
module.exports = {
    "Subscription ziplocker": "a7509c6c-94c6-4aa6-934c-a8788906a018",
    "Ziplocker's Graphics Pack V2": "9fbb25f9-2d70-44b2-901f-e2157a68d7eb",
    "Ziplocker's Graphics V2": "c83985f3-6a69-4901-8534-8785a211f5fb",
    "Ziplocker's Graphics Pack V1": "4a148487-5c0f-4f33-8a75-aebf850a2399",
    "Ziplocker's Blood FX": "6440f2c3-98bf-4f24-8684-fa124c74d5c4",
    "Ziplocker Summer Visuals": "f653e37f-59aa-4ba7-825a-53551a57f960",
    "Muzzle Core FX": "8f45204c-0a4f-4912-ada0-f822705ca301",
    "Muzzle Core FX | Flash Collection": "24ad821c-8819-4643-8d24-64c309d27970",
};
