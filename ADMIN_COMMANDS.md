# Шпаргалка — все команды бота

## Discord slash-команды (запускаются прямо в Discord)

Панели с кнопкой покупки — отправляют эмбед с кнопкой "Buy Now" в тот канал, где выполнена команда:

| Команда | Товар |
|---|---|
| `/panel` | Muzzle Core FX |
| `/panelflashcollection` | Muzzle Core FX \| Flash Collection |
| `/panelvisuals1` | Ziplocker's Graphics Pack (V1) |
| `/panelgraphicspackv2` | Ziplocker's Graphics Pack V2 |
| `/panelgraphicsv2` | Ziplocker's Graphics V2 |
| `/panelvisuals` | Ziplocker Summer Visuals |
| `/panelblood` | Ziplocker's Blood FX |
| `/panelaudio` | Complete Audio Overhaul |
| `/panelsubscribe` | Подписка (Membership) |

Сервисные панели:

| Команда | Что делает |
|---|---|
| `/getrole` | Панель "не выдалась роль" — покупатель вводит email, бот проверяет покупку и выдаёт роль (+ доставляет Muzzle Core FX/Flash Collection/Graphics Pack/подписку, если применимо). |
| `/panelredownload` | То же самое, но с акцентом на "получить свежую ссылку+ключ" — для миграции старых покупателей на версию с лицензионными ключами. |
| `/cancelsubscription email:<email>` | **Только админ.** Отменяет подписку на lava.top и снимает роль Membership. |
| `/ask <вопрос>` | Спросить ИИ-помощника откуда угодно. Ответ виден только тебе. |
| `/aiusage` | **Только админ.** Сколько токенов ИИ израсходовал, сколько осталось и на сколько ещё вопросов хватит. Плюс счётчик оценок 👍/👎. |

## Скрипты на сервере (`node <скрипт>.js ...`, выполнять в папке `~/discord-lava-bot`)

### Выдать товар вручную (нет записи о покупке — старый заказ, ручная оплата и т.п.)
```bash
node manual-deliver.js EMAIL DISCORD_ID "НАЗВАНИЕ ТОВАРА"
```
Записывает покупку, выдаёт роль, шлёт ссылку+ключ в личку (если DM закрыты — выведет ссылку и ключ в консоль, передать вручную).

Точные названия товаров (регистр и пунктуация важны):
```
Subscription ziplocker
Ziplocker's Graphics Pack V2
Ziplocker's Graphics V2
Ziplocker's Graphics Pack V1
Ziplocker's Blood FX
Ziplocker Summer Visuals
Muzzle Core FX
Muzzle Core FX | Flash Collection
Complete Audio Overhaul
```

### Рефанд (заблокировать email + снять роль)
```bash
node add-refund.js EMAIL ["НАЗВАНИЕ ТОВАРА"]
```
Название товара нужно указывать, только если у этого email несколько разных покупок (иначе скрипт сам скажет, если их несколько, и остановится).

### Отозвать/восстановить уже активированный лицензионный ключ
```bash
node revoke-key.js LICENSE-KEY           # отозвать
node revoke-key.js LICENSE-KEY unrevoke  # восстановить
```
Приложение проверяет это при каждом запуске (если есть интернет, с таймаутом 4 сек — офлайн работать не перестанет). Отозванный ключ сбрасывает активацию и снова просит ввести ключ.

## Быстрые проверки (диагностика, не меняют данные)

Все покупки на email:
```bash
node -e "console.log(JSON.stringify(require('./purchaseStore').getAllPurchases('EMAIL'), null, 2))"
```

Ссылка+ключ по email (если DM не дошло и нужно передать вручную):
```bash
node -e "
const db = JSON.parse(require('fs').readFileSync('watermarkStore.json', 'utf-8'));
for (const [token, r] of Object.entries(db)) {
  if (r.email === 'EMAIL') {
    console.log(r.productTitle);
    console.log('  Download:', 'https://ziplocker-bot.biz/download/' + token);
    console.log('  License key:', r.licenseKey);
  }
}
"
```

То же самое, но по Discord ID (если email неизвестен):
```bash
node -e "
const db = JSON.parse(require('fs').readFileSync('watermarkStore.json', 'utf-8'));
for (const [token, r] of Object.entries(db)) {
  if (r.discordId === 'DISCORD_ID') {
    console.log(r.productTitle, '(' + r.email + ')');
    console.log('  License key:', r.licenseKey);
    console.log('  Download:', 'https://ziplocker-bot.biz/download/' + token);
  }
}
"
```

Статус конкретного ключа (валиден/отозван):
```bash
curl -s "https://ziplocker-bot.biz/license-status?key=LICENSE-KEY"
```

Логи бота (последние строки / ошибки):
```bash
pm2 logs discord-lava-bot --lines 100 --nostream
pm2 logs discord-lava-bot --lines 100 --nostream | grep -i error
```

Перезапуск бота (после `git pull` или если что-то зависло):
```bash
pm2 restart discord-lava-bot
```

## Деплой изменений

На своём компьютере (после того, как я что-то поправил в коде):
```bash
git add -A
git commit -m "..."
git push origin main
```

На сервере:
```bash
cd ~/discord-lava-bot
git pull origin main
pm2 restart discord-lava-bot
```

Если менялся сам конфигуратор (C# приложение) — нужно ещё пересобрать и перезалить `app-template`:
```bash
# на компьютере: dotnet publish, потом
ssh root@150.241.66.179 "rm -rf ~/discord-lava-bot/app-template"
scp -r "C:\1\ZWorkshop\ZWorkshop\bin\Release\net8.0-windows\win-x64\publish" root@150.241.66.179:/root/discord-lava-bot/app-template
```
