"use client";

import Link from "next/link";
import { AppShell } from "./components/app-shell";
import { money, useListokStore } from "./store";

export default function HomePage() {
  const { data, ready } = useListokStore();
  const activeRequests = data.requests.filter((request) => request.status === "open");
  const completedRequests = data.requests.filter((request) => request.status === "done" && request.purchases?.length);
  const totalSpent = completedRequests.reduce(
    (sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0),
    0,
  );
  const averageReceipt = completedRequests.length ? totalSpent / completedRequests.length : 0;
  const monthStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const spentLast30Days = completedRequests
    .filter((request) => !request.createdAtIso || new Date(request.createdAtIso).getTime() >= monthStart)
    .reduce((sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0), 0);

  return (
    <AppShell title="Учёт закупок" action={<Link className="button primary" href="/requests/new">Создать запрос</Link>}>
      <section className="summary" aria-label="Сводка">
        <Link href="/products"><span>Продукты</span><strong>{ready ? data.products.length : "—"}</strong><small>ед.</small></Link>
        <Link href="/requests"><span>Активные запросы</span><strong>{ready ? activeRequests.length : "—"}</strong><small>{activeRequests.reduce((sum, request) => sum + request.items.length, 0)} поз.</small></Link>
        <div><span>Сумма закупок</span><strong>{ready ? money(totalSpent) : "—"}</strong><small>всего</small></div>
        <div><span>Средний чек</span><strong>{ready ? money(averageReceipt) : "—"}</strong><small>{completedRequests.length} закупок</small></div>
        <div><span>Траты за 30 дней</span><strong>{ready ? money(spentLast30Days) : "—"}</strong><small>последние 30 дней</small></div>
      </section>

      <section className="registry">
        <header><h2>Активные запросы</h2><Link href="/requests">Открыть список</Link></header>
        <div className="request-table compact">
          <div className="table-header"><span>Наименование</span><span>Дата</span><span>Позиций</span><span>Действие</span></div>
          {activeRequests.map((request) => (
            <Link className="table-row" href={`/requests/${request.id}`} key={request.id}>
              <strong>{request.title}</strong>
              <span>{request.createdAt}</span>
              <span>{request.items.length}</span>
              <span className="row-action">Заполнить →</span>
            </Link>
          ))}
          {ready && activeRequests.length === 0 && <div className="empty-row"><span>Активные запросы отсутствуют.</span><Link href="/requests/new">Создать запрос</Link></div>}
        </div>
      </section>
    </AppShell>
  );
}
