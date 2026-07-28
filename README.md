# Листок

Учёт продуктов, запросов на закупку и фактических трат.

## Android

Android-приложение автономно: интерфейс и данные находятся на телефоне. Docker,
локальный сервер и файл `.env` для его работы не нужны. Подключённая Google
Таблица обновляется после изменений и фоновой задачей WorkManager каждые
15 минут при наличии сети.

Сборка:

```powershell
npm install
npm run android:apk
```

Готовый файл: `output/Listok-debug.apk`.

Для Google-входа и Google Sheets в Google Cloud должны быть:

1. Включён Google Sheets API.
2. Создан OAuth-клиент типа Android.
3. Package name: `ru.listok.purchases`.
4. SHA-1 debug-сертификата:
   `90:4F:BD:1C:8B:33:D5:7E:96:82:CD:26:F9:48:06:F9:D5:3A:39:9E`.
5. На экране согласия добавлены scopes:
   `openid`, `userinfo.email`, `userinfo.profile`, `spreadsheets`.

Client Secret для Android-приложения не используется.

В профиле можно создать или подключить таблицу, открыть её для редактирования
в Google Sheets и отправить ссылку через системное меню Android.

Для совместной работы оба пользователя подключают одну и ту же Google Таблицу.
Приложение объединяет записи по идентификатору и времени изменения. Новые
активные запросы другого пользователя показываются системным уведомлением
после фоновой проверки. На Android 13+ необходимо разрешить уведомления.
Пока приложение открыто, общая таблица синхронизируется каждые 5 секунд;
после сворачивания используется фоновая проверка.

## Веб-версия

Запуск через Docker:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

После запуска сайт доступен на `http://localhost:3000`.

Для веб-версии требуется отдельный OAuth-клиент типа Web application.
Redirect URI: `http://localhost:3000/api/auth/google/callback`.

Остановка:

```powershell
docker compose down
```
