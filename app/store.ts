"use client";

import { useCallback, useEffect, useState } from "react";

export type Product = { id: string; name: string; category: string; unit: string };
export type RequestItem = { productId: string; quantity: number };
export type Purchase = RequestItem & { price: number };
export type PurchaseRequest = {
  id: string;
  title: string;
  createdAt: string;
  createdAtIso?: string;
  status: "open" | "done";
  items: RequestItem[];
  purchases?: Purchase[];
};
export type ListokData = { products: Product[]; requests: PurchaseRequest[] };

const STORAGE_KEY = "listok-data-v2";
const EMPTY_DATA: ListokData = { products: [], requests: [] };

export function useListokStore() {
  const [data, setData] = useState<ListokData>(EMPTY_DATA);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      setData(value ? JSON.parse(value) as ListokData : EMPTY_DATA);
    } catch {
      setData(EMPTY_DATA);
    }
    setReady(true);
  }, []);

  const update = useCallback((recipe: (current: ListokData) => ListokData) => {
    setData((current) => {
      const next = recipe(current);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { data, ready, update };
}

export function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value);
}

export function requestDate() {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}
