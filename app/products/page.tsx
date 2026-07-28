"use client";

import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { useListokStore } from "../store";

export default function ProductsPage() {
  const { data, ready } = useListokStore();
  return (
    <AppShell title="Продукты" action={<Link className="button primary" href="/products/new">Добавить продукт</Link>}>
      <section className="registry">
        <div className="product-table">
          <div className="table-header"><span>Наименование</span><span>Категория</span><span>Единица</span></div>
          {data.products.map((product) => <div className="table-row" key={product.id}><strong>{product.name}</strong><span>{product.category}</span><span>{product.unit}</span></div>)}
          {ready && data.products.length === 0 && <div className="empty-row"><span>Продукты отсутствуют.</span><Link href="/products/new">Добавить продукт</Link></div>}
        </div>
      </section>
    </AppShell>
  );
}
