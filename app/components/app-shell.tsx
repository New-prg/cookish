"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useGoogleSession } from "./google-session";

export function AppShell({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const googleSession = useGoogleSession();
  const section = pathname.startsWith("/products")
    ? "products"
    : pathname.startsWith("/requests")
      ? "requests"
      : pathname.startsWith("/profile")
        ? "profile"
        : "home";

  useEffect(() => {
    if (googleSession && !googleSession.authenticated) window.location.replace("/login");
  }, [googleSession]);

  if (!googleSession?.authenticated) return <main className="auth-check">Проверка доступа</main>;

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">ЛИСТОК</Link>
        <nav className="desktop-nav" aria-label="Разделы">
          <Link className={section === "home" ? "active" : ""} href="/">Сводка</Link>
          <Link className={section === "products" ? "active" : ""} href="/products">Продукты</Link>
          <Link className={section === "requests" ? "active" : ""} href="/requests">Запросы</Link>
          <Link className={section === "profile" ? "active" : ""} href="/profile">Профиль</Link>
        </nav>
        <span className="system-state"><i /> Локальное хранилище</span>
      </header>

      <div className="workspace">
        <header className="page-header">
          <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
          {action && <div className="page-action">{action}</div>}
        </header>
        {children}
      </div>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <Link className={section === "home" ? "active" : ""} href="/">Сводка</Link>
        <Link className={section === "products" ? "active" : ""} href="/products">Продукты</Link>
        <Link className={section === "requests" ? "active" : ""} href="/requests">Запросы</Link>
        <Link className={section === "profile" ? "active" : ""} href="/profile">Профиль</Link>
      </nav>
    </main>
  );
}
