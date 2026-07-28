"use client";

import Link from "next/link";
import { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { requestDate, useListokStore } from "../../store";

export default function NewRequestPage() {
  const router = useRouter();
  const { data, ready, update } = useListokStore();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const items = data.products.flatMap((product) => {
      const quantity = Number(form.get(`quantity-${product.id}`) ?? 0);
      return quantity > 0 ? [{ productId: product.id, quantity }] : [];
    });
    if (!items.length) return;
    const id = crypto.randomUUID();
    update((current) => ({
      ...current,
      requests: [{
        id,
        title: String(form.get("title") ?? "").trim(),
        createdAt: requestDate(),
        createdAtIso: new Date().toISOString(),
        status: "open",
        items,
      }, ...current.requests],
    }));
    router.push(`/requests/${id}`);
  }

  if (ready && data.products.length === 0) {
    return <AppShell title="Новый запрос"><div className="empty-row standalone"><span>Продукты отсутствуют.</span><Link href="/products/new">Добавить продукт</Link></div></AppShell>;
  }

  return (
    <AppShell title="Новый запрос" subtitle="Укажите продукты и количество.">
      <form className="request-work-form" onSubmit={submit}>
        <label className="request-name"><span>Наименование запроса</span><input name="title" required autoFocus /></label>
        <section className="entry-table">
          <div className="table-header"><span>Продукт</span><span>Категория</span><span>Количество</span><span>Единица</span></div>
          {data.products.map((product) => (
            <label className="table-row" key={product.id}><strong>{product.name}</strong><span>{product.category}</span><input name={`quantity-${product.id}`} type="number" min="0" step="0.1" placeholder="0" inputMode="decimal" /><span>{product.unit}</span></label>
          ))}
        </section>
        <footer><button className="button" type="button" onClick={() => router.back()}>Отмена</button><button className="button primary" type="submit">Создать</button></footer>
      </form>
    </AppShell>
  );
}
