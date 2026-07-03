import { useState, useCallback } from "react";

const STORAGE_KEY = "lore_admin_token";

export function useAdminToken() {
  const [token, setTokenState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const saveToken = useCallback((t: string) => {
    const trimmed = t.trim();
    try {
      if (trimmed) {
        localStorage.setItem(STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
    }
    setTokenState(trimmed);
  }, []);

  const clearToken = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
    }
    setTokenState("");
  }, []);

  return { token, saveToken, clearToken };
}
