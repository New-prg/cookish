import { NextRequest, NextResponse } from "next/server";
import { appendSheetRow, googleConfigured } from "../../../lib/google";
import { sendTelegramMessage, telegramConfigured } from "../../../lib/telegram";

type EventPayload = {
  event?: string;
  source?: string;
  message?: string;
  values?: unknown[];
};

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.EVENT_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-webhook-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as EventPayload;
  const event = clean(payload.event) || "Новое событие";
  const source = clean(payload.source) || "Google Forms";
  const message = clean(payload.message) || `${event} из ${source}`;
  const tasks: Promise<unknown>[] = [];

  if (googleConfigured()) {
    tasks.push(appendSheetRow(payload.values ?? [new Date().toISOString(), source, event, message]));
  }
  if (telegramConfigured()) {
    tasks.push(sendTelegramMessage(`🔔 ${event}\n${message}\nИсточник: ${source}`));
  }
  await Promise.all(tasks);

  return NextResponse.json({
    ok: true,
    deliveries: {
      googleSheets: googleConfigured(),
      telegram: telegramConfigured(),
    },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}
