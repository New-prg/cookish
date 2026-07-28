# Листок — учёт закупок продуктов

Каталог продуктов, запросы на закупку и фиксация фактических количеств и цен.

## Запуск через Docker

```bash
docker compose up --build -d
```

После запуска сайт доступен на `http://localhost:3000`.

Остановка:

```bash
docker compose down
```

Переменные интеграций можно скопировать из `.env.example` в `.env`. Для локальной
работы требуется настроить Google OAuth:

1. В Google Cloud включите Google Sheets API.
2. Создайте OAuth Client типа Web application.
3. Добавьте redirect URI `http://localhost:3000/api/auth/google/callback`.
4. Заполните `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` и `AUTH_SECRET` в `.env`.

`AUTH_SECRET` должен быть случайной строкой длиной не менее 32 символов.

## Запуск через npm

```bash
npm install
npm run dev
```

## Android APK

Мобильная сборка подключается к локальному серверу на ПК. Адрес задаётся через
`CAPACITOR_SERVER_URL`. Телефон и ПК должны находиться в одной сети.

```bash
$env:CAPACITOR_SERVER_URL="http://10.10.40.165:3000"
npm run android:apk
```

Готовый файл: `output/Listok-debug.apk`.

## Техническая основа

Vinext / React / Next.js, адаптивный PWA-интерфейс и опциональные серверные
интеграции с Google Sheets и Telegram.
