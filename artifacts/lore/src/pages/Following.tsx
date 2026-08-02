import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Following page — removed as part of follow-mechanism removal.
 * Redirects to /selectors, which surfaces taste-match discovery through
 * listening behaviour instead.
 */
export default function Following() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/selectors", { replace: true });
  }, [navigate]);
  return null;
}
