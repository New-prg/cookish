import { NextRequest, NextResponse } from "next/server";
import {
  encryptPayload,
  ensureGoogleAccessToken,
  GOOGLE_SESSION_COOKIE,
  readGoogleSession,
  sessionCookieOptions,
} from "../../../../../lib/google-session";

type Product = { id: string; name: string; category: string; unit: string };
type RequestItem = { productId: string; quantity: number };
type Purchase = RequestItem & { price: number };
type PurchaseRequest = {
  id: string;
  title: string;
  createdAt: string;
  status: "open" | "done";
  items: RequestItem[];
  purchases?: Purchase[];
};
type SyncData = { products: Product[]; requests: PurchaseRequest[] };
type SheetProperties = { sheetId: number; title: string };

const SHEETS = [
  { title: "Продукты", columns: 4 },
  { title: "Запросы", columns: 4 },
  { title: "Покупки", columns: 5 },
] as const;

export async function POST(request: NextRequest) {
  const session = await readGoogleSession();
  if (!session) return NextResponse.json({ error: "Требуется вход через Google." }, { status: 401 });

  try {
    const body = await request.json() as { spreadsheet?: string; data?: SyncData };
    const spreadsheetId = extractSpreadsheetId(body.spreadsheet ?? "");
    if (!spreadsheetId) return NextResponse.json({ error: "Укажите ссылку или идентификатор таблицы." }, { status: 400 });
    const data = body.data ?? { products: [], requests: [] };
    const access = await ensureGoogleAccessToken(session);
    const auth = { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" };

    let metadata = await getMetadata(spreadsheetId, auth);
    const structuralRequests: unknown[] = [];
    const existingTitles = new Set(metadata.sheets.map((sheet) => sheet.properties.title));

    if (!existingTitles.has("Продукты") && metadata.sheets.length === 1) {
      const first = metadata.sheets[0].properties;
      const empty = await sheetIsEmpty(spreadsheetId, first.title, auth);
      if (empty) {
        structuralRequests.push({
          updateSheetProperties: {
            properties: { sheetId: first.sheetId, title: "Продукты" },
            fields: "title",
          },
        });
        existingTitles.add("Продукты");
      }
    }
    for (const sheet of SHEETS) {
      if (!existingTitles.has(sheet.title)) structuralRequests.push({ addSheet: { properties: { title: sheet.title } } });
    }
    if (structuralRequests.length) {
      await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, auth, {
        requests: structuralRequests,
      });
      metadata = await getMetadata(spreadsheetId, auth);
    }

    const properties = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties]));
    await formatSheets(spreadsheetId, properties, auth);
    await writeData(spreadsheetId, data, auth);

    const response = NextResponse.json({
      ok: true,
      spreadsheetId,
      title: metadata.properties.title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheets: SHEETS.map((sheet) => sheet.title),
    });
    if (access.refreshed) {
      response.cookies.set(GOOGLE_SESSION_COOKIE, await encryptPayload(access.session), sessionCookieOptions(request.url));
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось настроить таблицу.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function getMetadata(spreadsheetId: string, headers: HeadersInit) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set("fields", "spreadsheetId,properties.title,sheets.properties(sheetId,title)");
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(await googleError(response, "Не удалось открыть таблицу."));
  return response.json() as Promise<{ properties: { title: string }; sheets: Array<{ properties: SheetProperties }> }>;
}

async function sheetIsEmpty(spreadsheetId: string, title: string, headers: HeadersInit) {
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:Z2`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, { headers });
  if (!response.ok) throw new Error(await googleError(response, "Не удалось проверить таблицу."));
  const result = await response.json() as { values?: unknown[][] };
  return !result.values?.length;
}

async function formatSheets(spreadsheetId: string, properties: Map<string, SheetProperties>, headers: HeadersInit) {
  const requests = SHEETS.flatMap((sheet) => {
    const property = properties.get(sheet.title);
    if (!property) return [];
    return [
      {
        updateSheetProperties: {
          properties: { sheetId: property.sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: property.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: sheet.columns },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.91, green: 0.93, blue: 0.91 },
              textFormat: { bold: true },
              horizontalAlignment: "LEFT",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId: property.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: sheet.columns },
        },
      },
    ];
  });
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, headers, { requests });
}

async function writeData(spreadsheetId: string, data: SyncData, headers: HeadersInit) {
  const requestRows = data.requests.map((request) => [request.id, request.title, request.createdAt, request.status === "open" ? "Открыт" : "Закрыт"]);
  const purchaseRows = data.requests.flatMap((request) => request.items.map((item) => {
    const purchase = request.purchases?.find((value) => value.productId === item.productId);
    return [request.id, item.productId, item.quantity, purchase?.quantity ?? "", purchase?.price ?? ""];
  }));
  const ranges = ["Продукты!A2:D", "Запросы!A2:D", "Покупки!A2:E"];
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, headers, { ranges });
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, headers, {
    valueInputOption: "USER_ENTERED",
    data: [
      { range: "Продукты!A1:D", values: [["id", "Наименование", "Категория", "Единица"], ...data.products.map((product) => [product.id, product.name, product.category, product.unit])] },
      { range: "Запросы!A1:D", values: [["id", "Наименование", "Дата", "Статус"], ...requestRows] },
      { range: "Покупки!A1:E", values: [["request_id", "product_id", "Запрошено", "Куплено", "Цена"], ...purchaseRows] },
    ],
  });
}

async function googleFetch(url: string, headers: HeadersInit, body: unknown) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await googleError(response, "Ошибка Google Sheets API."));
  return response.json();
}

async function googleError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function extractSpreadsheetId(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}
