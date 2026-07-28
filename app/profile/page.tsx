"use client";

import { AppShell } from "../components/app-shell";
import { money, useListokStore } from "../store";

export default function ProfilePage() {
  const { data, ready } = useListokStore();
  const active = data.requests.filter((request) => request.status === "open");
  const completed = data.requests.filter((request) => request.status === "done");
  const purchases = completed.filter((request) => request.purchases?.length);
  const totalSpent = purchases.reduce(
    (sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0),
    0,
  );
  const averageReceipt = purchases.length ? totalSpent / purchases.length : 0;
  const monthStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const spentLast30Days = purchases
    .filter((request) => !request.createdAtIso || new Date(request.createdAtIso).getTime() >= monthStart)
    .reduce((sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0), 0);

  return (
    <AppShell title="Профиль">
      <section className="registry profile-registry">
        <header><h2>Статистика</h2></header>
        <div className="profile-table">
          <div className="table-header"><span>Показатель</span><span>Значение</span></div>
          <div className="table-row"><span>Все запросы</span><strong>{ready ? data.requests.length : "—"}</strong></div>
          <div className="table-row"><span>Активные запросы</span><strong>{ready ? active.length : "—"}</strong></div>
          <div className="table-row"><span>Завершённые закупки</span><strong>{ready ? completed.length : "—"}</strong></div>
          <div className="table-row"><span>Сумма трат</span><strong>{ready ? money(totalSpent) : "—"}</strong></div>
          <div className="table-row"><span>Средний чек</span><strong>{ready ? money(averageReceipt) : "—"}</strong></div>
          <div className="table-row"><span>Траты за 30 дней</span><strong>{ready ? money(spentLast30Days) : "—"}</strong></div>
        </div>
      </section>
    </AppShell>
  );
}
