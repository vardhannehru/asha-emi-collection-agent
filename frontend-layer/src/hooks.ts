import { useEffect, useState } from "react";
import { api } from "./api";

// Loads a list from the backend and keeps it fresh while the page is open.
export function useFetch<T>(path: string, everyMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const fresh = await api<T>(path);
        if (alive) {
          setData(fresh);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const timer = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, everyMs]);
  return { data, error };
}
