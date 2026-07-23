// Product id of the "Subscription ziplocker" product on lava.top
// (the top-level product id, NOT the offer id used for invoice creation).
// Confirm this against a real webhook payload (see console.log("Body:", ...)
// in webhookServer.js) — if lava.top sends a different id in event.product.id
// for subscriptions, update the value below.
const SUBSCRIPTION_PRODUCT_ID = "a7509c6c-94c6-4aa6-934c-a8788906a018";

// Returns the list of Discord role IDs that should be granted for a given
// lava.top product id.
//
// ROLE_ID is the base "customers" role and is granted for every purchase.
// SUBSCRIBE_ROLE_ID is granted additionally when the product is the
// Membership subscription.
function getRolesForProduct(productId) {
    const roles = [];

    if (process.env.ROLE_ID) roles.push(process.env.ROLE_ID);

    if (productId === SUBSCRIPTION_PRODUCT_ID) {
        if (process.env.SUBSCRIBE_ROLE_ID) roles.push(process.env.SUBSCRIBE_ROLE_ID);
    }

    return roles;
}

module.exports = { getRolesForProduct, SUBSCRIPTION_PRODUCT_ID };
