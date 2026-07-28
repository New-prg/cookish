import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const origin = `${protocol}://${host}`;

  return {
    title: "Листок — учёт закупок продуктов",
    description: "Каталог продуктов, запросы на закупку и учёт фактических цен.",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/favicon.svg",
    },
    openGraph: {
      title: "Листок",
      description: "Продукты → запрос на закупку → фактические цены",
      images: [{ url: `${origin}/og-purchases.png`, width: 1200, height: 630, alt: "Листок — учёт закупок продуктов" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Листок",
      description: "Продукты → запрос на закупку → фактические цены",
      images: [`${origin}/og-purchases.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
