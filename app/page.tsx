"use client";

import Link from "next/link";
import { AppShell } from "./components/app-shell";
import { money, useListokStore } from "./store";

export default function HomePage() {
  const { data, ready } = useListokStore();
  const open = data.requests.filter((request) => request.status === "open");
  const spent = data.requests.reduce((sum, request) => sum + (request.purchases?.reduce((value, item) => value + item.price, 0) ?? 0), 0);

  return (
    <AppShell title="Учёт закупок" action={<Link className="button primary" href="/requests/new">Создать запрос</Link>}>
      <section className="summary" aria-label="Сводка">
        <Link href="/products"><span>Продукты</span><strong>{ready ? data.products.length : "—"}</strong><small>ед.</small></Link>
        <Link href="/requests"><span>Открытые запросы</span><strong>{ready ? open.length : "—"}</strong><small>{open.reduce((sum, request) => sum + request.items.length, 0)} поз.</small></Link>
        <div><span>Сумма закупок</span><strong>{ready ? money(spent) : "—"}</strong><small>всего</small></div>
      </section>

      <section className="registry">
        <header><h2>Операции</h2></header>
        <div className="operation-list">
          <Link href="/products/new"><span>01</span><strong>Добавить продукт</strong><b>→</b></Link>
          <Link href="/requests/new"><span>02</span><strong>Создать запрос</strong><b>→</b></Link>
          <Link href="/requests"><span>03</span><strong>Ввести данные закупки</strong><b>→</b></Link>
        </div>
      </section>

      <section className="registry">
        <header><h2>Последние запросы</h2><Link href="/requests">Открыть список</Link></header>
        <div className="request-table compact">
          <div className="table-header"><span>Статус</span><span>Наименование</span><span>Дата</span><span>Позиций</span></div>
          {data.requests.slice(0, 5).map((request) => (
            <Link className="table-row" href={`/requests/${request.id}`} key={request.id}>
              <span><i className={`status-mark ${request.status}`} />{request.status === "open" ? "Открыт" : "Закрыт"}</span>
              <strong>{request.title}</strong><span>{request.createdAt}</span><span>{request.items.length}</span>
            </Link>
          ))}
          {ready && data.requests.length === 0 && <Empty text="Запросы отсутствуют." href="/requests/new" action="Создать запрос" />}
        </div>
      </section>
    </AppShell>
  );
}

function Empty({ text, href, action }: { text: string; href: string; action: string }) {
  return <div className="empty-row"><span>{text}</span><Link href={href}>{action}</Link></div>;
}
