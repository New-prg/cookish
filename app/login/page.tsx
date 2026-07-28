"use client";

import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const error = useSearchParams().get("error");
  return (
    <main className="login-page">
      <header className="login-header">ЛИСТОК</header>
      <section className="login-form">
        <h1>Вход</h1>
        <p>Используйте учётную запись Google.</p>
        {error === "config" && (
          <div className="system-message error">
            Авторизация не настроена. Добавьте GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET и AUTH_SECRET в файл .env.
          </div>
        )}
        {error === "oauth" && <div className="system-message error">Google не выполнил авторизацию. Повторите вход.</div>}
        <a className="button primary google-login" href="/api/auth/google/start">Войти через Google</a>
      </section>
    </main>
  );
}
