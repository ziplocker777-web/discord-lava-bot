import express from 'express';
import crypto from 'crypto';
import { checkUserRole, assignRoleToUser } from './index.js';
import { savePurchase } from './purchaseStore.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Важно: парсим сырое тело для проверки подписи, если это необходимо
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

app.post('/webhook', async (req, res) => {
    console.log('========== WEBHOOK ==========');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { eventType, product, buyer, clientUtm } = req.body;
    const signature = req.headers['x-lava-signature'];

    // Проверка подписи (если она у тебя настроена, код остаётся прежним)
    /*
    if (!signature) {
        console.log('No signature found');
        return res.status(400).send('No signature');
    }
    const computedSignature = crypto
        .createHmac('sha256', process.env.LAVA_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (signature !== computedSignature) {
        console.log('Invalid signature');
        return res.status(400).send('Invalid signature');
    }
    */

    try {
        if (eventType === 'payment.success') {
            const discordId = clientUtm?.utm_content;
            
            // 1. Проверяем наличие Discord ID
            if (!discordId) {
                console.log(`No discordId found for ${buyer?.email || 'unknown email'}`);
                return res.status(200).send('Webhook received, but no discordId provided');
            }

            // 2. Проверяем, есть ли уже роль у пользователя
            const hasRole = await checkUserRole(discordId);
            if (hasRole) {
                console.log(`${discordId} already has the role.`);
                savePurchase(buyer.email, discordId, product.title);
                return res.status(200).send('Webhook processed, user already had the role');
            }

            // 3. Пытаемся выдать роль
            const success = await assignRoleToUser(discordId);
            if (success) {
                savePurchase(buyer.email, discordId, product.title);
                console.log(`Role successfully assigned to ${discordId}`);
                return res.status(200).send('Webhook processed and role assigned');
            } else {
                // Если Дискорд вернул ошибку (например, бот ниже роли в иерархии)
                console.error(`Failed to assign role to ${discordId} in Discord (Check hierarchy/permissions)`);
                return res.status(200).send('Webhook received, but Discord failed to assign role');
            }
        } else {
            // Игнорируем другие типы событий (например, payment.failed), отвечая 200 ОК
            console.log(`Event ${eventType} ignored.`);
            return res.status(200).send(`Event ${eventType} ignored`);
        }
    } catch (error) {
        // Ловим любые непредвиденные ошибки в коде, чтобы Lava не получала таймаут
        console.error('Error inside webhook processing:', error);
        return res.status(500).send('Internal server error during webhook processing');
    }
});

app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});