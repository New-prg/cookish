import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { sendTelegramMessage, telegramConfigured } from "../../../../lib/telegram";

export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ message: "Сначала войдите в кабинет" }, { status: 401 });
  if (!telegramConfigured()) {
    return NextResponse.json(
      { message: "Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в настройках сайта" },
      { status: 503 },
    );
  }
  await sendTelegramMessage(`✅ Листок подключён\nТест от ${user.displayName}`);
  return NextResponse.json({ message: "Тестовое сообщение отправлено в Telegram" });
}
