"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import { useGoogleSession } from "../components/google-session";
import { money, useListokStore } from "../store";

type ConnectedSheet = { spreadsheetId: string; title: string; url: string };

export default function ProfilePage() {
  const { data, ready } = useListokStore();
  const googleSession = useGoogleSession();
  const [sheet, setSheet] = useState<ConnectedSheet | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("listok-google-sheet");
    if (stored) setSheet(JSON.parse(stored) as ConnectedSheet);
  }, []);

  const active = data.requests.filter((request) => request.status === "open");
  const completed = data.requests.filter((request) => request.status === "done");
  const purchases = completed.filter((request) => request.purchases?.length);
  const totalSpent = purchases.reduce((sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0), 0);
  const averageReceipt = purchases.length ? totalSpent / purchases.length : 0;

  async function connectSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/google/sheets/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheet: form.get("spreadsheet"), data }),
      });
      const result = await response.json() as ConnectedSheet & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось подключить таблицу.");
      const connected = { spreadsheetId: result.spreadsheetId, title: result.title, url: result.url };
      localStorage.setItem("listok-google-sheet", JSON.stringify(connected));
      setSheet(connected);
      setMessage("Таблица настроена. Данные синхронизированы.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подключить таблицу.");
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/google/logout", { method: "POST" });
    window.location.replace("/login");
  }

  return (
    <AppShell title="Профиль">
      <section className="registry profile-registry">
        <header><h2>Учётная запись</h2><button className="text-action" onClick={logout}>Выйти</button></header>
        <div className="profile-table">
          <div className="table-row"><span>Пользователь</span><strong>{googleSession?.user?.name ?? "—"}</strong></div>
          <div className="table-row"><span>Электронная почта</span><strong>{googleSession?.user?.email ?? "—"}</strong></div>
        </div>
      </section>

      <section className="registry profile-registry">
        <header><h2>Google Таблица</h2></header>
        {sheet && <div className="connected-sheet"><span>Подключена</span><a href={sheet.url} target="_blank" rel="noreferrer">{sheet.title}</a></div>}
        <form className="sheet-form" onSubmit={connectSheet}>
          <label><span>Ссылка на пустую таблицу</span><input name="spreadsheet" type="url" placeholder="https://docs.google.com/spreadsheets/d/..." required /></label>
          <button className="button primary" type="submit" disabled={working}>{working ? "Настройка…" : sheet ? "Синхронизировать" : "Подключить"}</button>
        </form>
        <div className="schema-list">
          <span>Создаваемые листы</span>
          <strong>Продукты</strong><strong>Запросы</strong><strong>Покупки</strong>
        </div>
        {message && <div className="system-message">{message}</div>}
      </section>

      <section className="registry profile-registry">
        <header><h2>Статистика</h2></header>
        <div className="profile-table">
          <div className="table-header"><span>Показатель</span><span>Значение</span></div>
          <div className="table-row"><span>Все запросы</span><strong>{ready ? data.requests.length : "—"}</strong></div>
          <div className="table-row"><span>Активные запросы</span><strong>{ready ? active.length : "—"}</strong></div>
          <div className="table-row"><span>Завершённые закупки</span><strong>{ready ? completed.length : "—"}</strong></div>
          <div className="table-row"><span>Сумма трат</span><strong>{ready ? money(totalSpent) : "—"}</strong></div>
          <div className="table-row"><span>Средний чек</span><strong>{ready ? money(averageReceipt) : "—"}</strong></div>
        </div>
      </section>
    </AppShell>
  );
}
