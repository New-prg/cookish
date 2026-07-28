"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type User = { name: string; email: string };
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
type View = "overview" | "products" | "requests";

type DashboardProps = {
  user: User | null;
  signInHref: string;
  signOutHref: string;
};

const seedProducts: Product[] = [
  { id: "p1", name: "Молоко 3,2%", category: "Молочные продукты", unit: "л" },
  { id: "p2", name: "Яйца C1", category: "Молочные продукты", unit: "уп." },
  { id: "p3", name: "Картофель", category: "Овощи", unit: "кг" },
  { id: "p4", name: "Кофе зерновой", category: "Бакалея", unit: "уп." },
  { id: "p5", name: "Яблоки", category: "Фрукты", unit: "кг" },
  { id: "p6", name: "Хлеб цельнозерновой", category: "Выпечка", unit: "шт." },
];

const seedRequests: PurchaseRequest[] = [
  {
    id: "r1",
    title: "Закупка на 29 июля",
    createdAt: "28 июля, 10:20",
    status: "open",
    items: [{ productId: "p1", quantity: 3 }, { productId: "p3", quantity: 5 }, { productId: "p6", quantity: 2 }],
  },
  {
    id: "r2",
    title: "Продукты в офис",
    createdAt: "26 июля, 16:40",
    status: "done",
    items: [{ productId: "p2", quantity: 2 }, { productId: "p4", quantity: 1 }],
    purchases: [{ productId: "p2", quantity: 2, price: 269.8 }, { productId: "p4", quantity: 1, price: 1190 }],
  },
];

export function Dashboard({ user, signInHref, signOutHref }: DashboardProps) {
  const [view, setView] = useState<View>("overview");
  const [products, setProducts] = useState<Product[]>(seedProducts);
  const [requests, setRequests] = useState<PurchaseRequest[]>(seedRequests);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedProducts = localStorage.getItem("listok-products");
    const storedRequests = localStorage.getItem("listok-requests");
    if (storedProducts) setProducts(JSON.parse(storedProducts) as Product[]);
    if (storedRequests) setRequests(JSON.parse(storedRequests) as PurchaseRequest[]);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("listok-products", JSON.stringify(products));
    localStorage.setItem("listok-requests", JSON.stringify(requests));
  }, [products, requests, ready]);

  const openRequests = requests.filter((request) => request.status === "open");
  const spent = requests.reduce(
    (sum, request) => sum + (request.purchases?.reduce((total, item) => total + item.price, 0) ?? 0),
    0,
  );

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const product: Product = {
      id: crypto.randomUUID(),
      name: String(data.get("name") ?? "").trim(),
      category: String(data.get("category") ?? "").trim(),
      unit: String(data.get("unit") ?? "").trim(),
    };
    if (!product.name || !product.category || !product.unit) return;
    setProducts((current) => [product, ...current]);
    setProductFormOpen(false);
    event.currentTarget.reset();
    notify("Продукт добавлен в каталог");
  }

  function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const items = products.flatMap((product) => {
      const quantity = Number(data.get(`quantity-${product.id}`) ?? 0);
      return quantity > 0 ? [{ productId: product.id, quantity }] : [];
    });
    if (!items.length) {
      notify("Укажите количество хотя бы для одного продукта");
      return;
    }
    const title = String(data.get("title") ?? "").trim() || "Новая закупка";
    setRequests((current) => [{
      id: crypto.randomUUID(),
      title,
      createdAt: new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date()),
      status: "open",
      items,
    }, ...current]);
    setRequestFormOpen(false);
    event.currentTarget.reset();
    setView("requests");
    notify("Запрос на закупку создан");
  }

  function completeRequest(event: FormEvent<HTMLFormElement>, request: PurchaseRequest) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const purchases = request.items.map((item) => ({
      ...item,
      quantity: Number(data.get(`bought-${item.productId}`) ?? item.quantity),
      price: Number(data.get(`price-${item.productId}`) ?? 0),
    }));
    if (purchases.some((item) => item.price < 0)) return;
    setRequests((current) => current.map((item) => item.id === request.id ? { ...item, purchases, status: "done" } : item));
    setResponseId(null);
    notify("Закупка закрыта, цены сохранены");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Листок — главная">
          <span className="brand-mark">Л</span><span>Листок</span>
        </button>
        <nav className="nav" aria-label="Разделы">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>Обзор</button>
          <button className={view === "products" ? "active" : ""} onClick={() => setView("products")}>Продукты</button>
          <button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}>Закупки</button>
        </nav>
        {user ? (
          <div className="profile">
            <span className="avatar">{initials(user.name)}</span>
            <span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
            <a className="text-button" href={signOutHref}>Выйти</a>
          </div>
        ) : <a className="primary compact" href={signInHref}>Войти</a>}
      </header>

      <div className="workspace">
        <section className="page-intro">
          <div>
            <span className="eyebrow">{view === "overview" ? "УЧЁТ ПРОДУКТОВ" : view === "products" ? "КАТАЛОГ" : "ЗАПРОСЫ"}</span>
            <h1>{view === "overview" ? "Закупки под контролем" : view === "products" ? "Все продукты" : "Запросы на закупку"}</h1>
            <p>{view === "overview" ? "От заявки до чека — в одном простом месте." : view === "products" ? "Единый список продуктов с категориями и единицами измерения." : "Создавайте списки и фиксируйте фактические цены после покупки."}</p>
          </div>
          <div className="intro-actions">
            <button className="secondary" onClick={() => { setProductFormOpen(true); setRequestFormOpen(false); }}>+ Новый продукт</button>
            <button className="primary" onClick={() => { setRequestFormOpen(true); setProductFormOpen(false); }}>Создать запрос</button>
          </div>
        </section>

        {!user && (
          <section className="signin-banner">
            <div><strong>Вы работаете в демо-режиме</strong><span>Данные сохраняются на этом устройстве. Войдите для защищённой синхронизации.</span></div>
            <a className="primary" href={signInHref}>Войти</a>
          </section>
        )}

        {productFormOpen && <ProductForm onSubmit={addProduct} onClose={() => setProductFormOpen(false)} />}
        {requestFormOpen && <RequestForm products={products} onSubmit={createRequest} onClose={() => setRequestFormOpen(false)} />}

        {view === "overview" && (
          <>
            <section className="metrics">
              <article><span className="metric-icon green">▦</span><div><small>Продуктов в каталоге</small><strong>{products.length}</strong><em>доступны для заявки</em></div></article>
              <article><span className="metric-icon orange">◷</span><div><small>Ожидают закупки</small><strong>{openRequests.length}</strong><em>{openRequests.reduce((sum, item) => sum + item.items.length, 0)} позиций</em></div></article>
              <article><span className="metric-icon violet">₽</span><div><small>Потрачено</small><strong>{money(spent)}</strong><em>по закрытым заявкам</em></div></article>
            </section>
            <div className="content-grid">
              <ProductTable products={products.slice(0, 5)} onShowAll={() => setView("products")} />
              <RequestList requests={requests.slice(0, 3)} products={products} responseId={responseId} setResponseId={setResponseId} onComplete={completeRequest} onShowAll={() => setView("requests")} />
            </div>
          </>
        )}

        {view === "products" && <ProductTable products={products} onShowAll={undefined} />}
        {view === "requests" && <RequestList requests={requests} products={products} responseId={responseId} setResponseId={setResponseId} onComplete={completeRequest} onShowAll={undefined} />}

        <section className="sync-strip">
          <span className="sync-icon">↻</span>
          <div><span className="eyebrow">ХРАНЕНИЕ</span><strong>Локальный режим · синхронизацию с Google Sheets можно включить позже</strong></div>
          <span className="status-pill"><i /> Сохранено</span>
        </section>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function ProductForm({ onSubmit, onClose }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <form className="drawer-form" onSubmit={onSubmit}>
      <div className="form-heading"><div><span className="eyebrow">НОВАЯ ЗАПИСЬ</span><h2>Добавить продукт</h2></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>
      <label>Название<input name="name" placeholder="Например, рис басмати" required autoFocus /></label>
      <label>Категория<input name="category" placeholder="Бакалея" required /></label>
      <label>Единица<select name="unit" defaultValue="шт."><option>шт.</option><option>кг</option><option>л</option><option>уп.</option><option>г</option></select></label>
      <button className="primary" type="submit">Добавить в каталог</button>
    </form>
  );
}

function RequestForm({ products, onSubmit, onClose }: { products: Product[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <form className="drawer-form wide" onSubmit={onSubmit}>
      <div className="form-heading"><div><span className="eyebrow">НОВЫЙ ЗАПРОС</span><h2>Что нужно купить?</h2></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>
      <label className="full">Название запроса<input name="title" placeholder="Например, закупка на неделю" required autoFocus /></label>
      <div className="request-products full">
        {products.map((product) => <label key={product.id}><span><strong>{product.name}</strong><small>{product.category}</small></span><input name={`quantity-${product.id}`} type="number" min="0" step="0.1" placeholder="0" /><em>{product.unit}</em></label>)}
      </div>
      <button className="primary full" type="submit">Создать запрос</button>
    </form>
  );
}

function ProductTable({ products, onShowAll }: { products: Product[]; onShowAll?: () => void }) {
  return (
    <section className="panel products-panel">
      <div className="panel-heading"><div><span className="eyebrow">КАТАЛОГ</span><h2>Продукты</h2></div>{onShowAll && <button onClick={onShowAll}>Все продукты</button>}</div>
      <div className="product-table">
        <div className="table-head"><span>Название</span><span>Категория</span><span>Ед.</span></div>
        {products.map((product) => <article key={product.id}><span className="product-name"><i>{product.name[0]}</i><strong>{product.name}</strong></span><span>{product.category}</span><b>{product.unit}</b></article>)}
      </div>
      {!products.length && <p className="empty">Каталог пока пуст. Добавьте первый продукт.</p>}
    </section>
  );
}

function RequestList({ requests, products, responseId, setResponseId, onComplete, onShowAll }: {
  requests: PurchaseRequest[];
  products: Product[];
  responseId: string | null;
  setResponseId: (id: string | null) => void;
  onComplete: (event: FormEvent<HTMLFormElement>, request: PurchaseRequest) => void;
  onShowAll?: () => void;
}) {
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  return (
    <section className="panel requests-panel">
      <div className="panel-heading"><div><span className="eyebrow">ЗАКУПКИ</span><h2>Последние запросы</h2></div>{onShowAll && <button onClick={onShowAll}>Все запросы</button>}</div>
      <div className="request-list">
        {requests.map((request) => {
          const total = request.purchases?.reduce((sum, item) => sum + item.price, 0) ?? 0;
          return (
            <article className="request-card" key={request.id}>
              <div className="request-top">
                <div><strong>{request.title}</strong><small>{request.createdAt} · {request.items.length} поз.</small></div>
                <span className={request.status === "open" ? "badge open" : "badge done"}>{request.status === "open" ? "Нужно купить" : "Куплено"}</span>
              </div>
              <p>{request.items.map((item) => `${productMap.get(item.productId)?.name ?? "Продукт"} — ${item.quantity} ${productMap.get(item.productId)?.unit ?? ""}`).join(" · ")}</p>
              {request.status === "done" ? <div className="request-total">Итого <strong>{money(total)}</strong></div> : (
                <button className="answer-button" onClick={() => setResponseId(responseId === request.id ? null : request.id)}>Ответить на запрос</button>
              )}
              {responseId === request.id && (
                <form className="purchase-form" onSubmit={(event) => onComplete(event, request)}>
                  <span>Заполните факт покупки</span>
                  {request.items.map((item) => {
                    const product = productMap.get(item.productId);
                    return <label key={item.productId}><strong>{product?.name}</strong><input name={`bought-${item.productId}`} type="number" min="0" step="0.1" defaultValue={item.quantity} aria-label={`Количество ${product?.name}`} /><em>{product?.unit}</em><input name={`price-${item.productId}`} type="number" min="0" step="0.01" placeholder="Цена, ₽" required aria-label={`Цена ${product?.name}`} /></label>;
                  })}
                  <button className="primary" type="submit">Сохранить покупку</button>
                </form>
              )}
            </article>
          );
        })}
      </div>
      {!requests.length && <p className="empty">Запросов пока нет. Создайте первый список закупки.</p>}
    </section>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
