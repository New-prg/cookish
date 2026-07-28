"use client";

import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { money, useListokStore } from "../store";

export default function RequestsPage() {
  const { data, ready } = useListokStore();
  return (
    <AppShell title="Запросы" action={<Link className="button primary" href="/requests/new">Создать запрос</Link>}>
      <section className="registry">
        <div className="request-table">
          <div className="table-header"><span>Статус</span><span>Наименование</span><span>Дата</span><span>Позиций</span><span>Сумма</span></div>
          {data.requests.map((request) => {
            const total = request.purchases?.reduce((sum, item) => sum + item.price, 0) ?? 0;
            return (
              <Link className="table-row" href={`/requests/${request.id}`} key={request.id}>
                <span><i className={`status-mark ${request.status}`} />{request.status === "open" ? "Открыт" : "Закрыт"}</span>
                <strong>{request.title}</strong><span>{request.createdAt}</span><span>{request.items.length}</span><span>{request.status === "done" ? money(total) : "—"}</span>
              </Link>
            );
          })}
          {ready && data.requests.length === 0 && <div className="empty-row"><span>Запросы отсутствуют.</span><Link href={data.products.length ? "/requests/new" : "/products/new"}>{data.products.length ? "Создать запрос" : "Добавить продукт"}</Link></div>}
        </div>
      </section>
    </AppShell>
  );
}
