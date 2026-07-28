"use client";

import { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useListokStore } from "../../store";

export default function NewProductPage() {
  const router = useRouter();
  const { update } = useListokStore();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const unit = String(form.get("unit") ?? "").trim();
    if (!name || !category || !unit) return;
    update((current) => ({ ...current, products: [{ id: crypto.randomUUID(), name, category, unit }, ...current.products] }));
    router.push("/products");
  }

  return (
    <AppShell title="Новый продукт" subtitle="Заполните поля.">
      <form className="work-form" onSubmit={submit}>
        <label><span>Наименование</span><input name="name" required autoFocus /></label>
        <label><span>Категория</span><input name="category" required /></label>
        <label><span>Единица измерения</span><select name="unit" defaultValue="шт."><option>шт.</option><option>кг</option><option>г</option><option>л</option><option>мл</option><option>уп.</option></select></label>
        <footer><button className="button" type="button" onClick={() => router.back()}>Отмена</button><button className="button primary" type="submit">Сохранить</button></footer>
      </form>
    </AppShell>
  );
}
