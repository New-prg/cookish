"use client";

import Link from "next/link";
import { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { money, useListokStore } from "../../store";

export function RequestDetails({ id }: { id: string }) {
  const router = useRouter();
  const { data, ready, update } = useListokStore();
  const request = data.requests.find((item) => item.id === id);
  const productMap = new Map(data.products.map((product) => [product.id, product]));

  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    const form = new FormData(event.currentTarget);
    const purchases = request.items.map((item) => ({
      productId: item.productId,
      quantity: Number(form.get(`quantity-${item.productId}`) ?? item.quantity),
      price: Number(form.get(`price-${item.productId}`) ?? 0),
    }));
    update((current) => ({ ...current, requests: current.requests.map((item) => item.id === id ? { ...item, status: "done", purchases } : item) }));
    router.refresh();
  }

  if (!ready) return <AppShell title="Загрузка"><div className="loading-line" /></AppShell>;
  if (!request) return <AppShell title="Запрос не найден"><div className="empty-row standalone"><span>Данные отсутствуют.</span><Link href="/requests">Открыть список</Link></div></AppShell>;

  const total = request.purchases?.reduce((sum, item) => sum + item.price, 0) ?? 0;
  return (
    <AppShell
      title={request.title}
      subtitle={`${request.createdAt} · ${request.items.length} поз.`}
      action={<span className={`status-label ${request.status}`}>{request.status === "open" ? "ОТКРЫТ" : "ЗАКРЫТ"}</span>}
    >
      {request.status === "open" ? (
        <form className="request-work-form" onSubmit={complete}>
          <header className="section-header"><h2>Данные закупки</h2><p>Введите фактическое количество и общую цену позиции.</p></header>
          <section className="purchase-entry-table">
            <div className="table-header"><span>Продукт</span><span>Запрошено</span><span>Куплено</span><span>Цена, ₽</span></div>
            {request.items.map((item) => {
              const product = productMap.get(item.productId);
              return (
                <label className="table-row" key={item.productId}>
                  <strong>{product?.name ?? "Удалённый продукт"}</strong>
                  <span>{item.quantity} {product?.unit}</span>
                  <span className="input-unit"><input name={`quantity-${item.productId}`} type="number" min="0" step="0.1" defaultValue={item.quantity} required inputMode="decimal" /><em>{product?.unit}</em></span>
                  <input name={`price-${item.productId}`} type="number" min="0" step="0.01" placeholder="0,00" required inputMode="decimal" />
                </label>
              );
            })}
          </section>
          <footer><Link className="button" href="/requests">Назад</Link><button className="button primary" type="submit">Завершить закупку</button></footer>
        </form>
      ) : (
        <section className="registry">
          <header><h2>Купленные товары</h2><strong>{money(total)}</strong></header>
          <div className="purchase-result-table">
            <div className="table-header"><span>Продукт</span><span>Количество</span><span>Цена</span></div>
            {request.purchases?.map((item) => {
              const product = productMap.get(item.productId);
              return <div className="table-row" key={item.productId}><strong>{product?.name ?? "Удалённый продукт"}</strong><span>{item.quantity} {product?.unit}</span><span>{money(item.price)}</span></div>;
            })}
            <div className="total-row"><span>Итого</span><strong>{money(total)}</strong></div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
