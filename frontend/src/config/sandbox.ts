/**
 * 沙盒 1：前端 UI
 * - 預設 Mock only（三沙盒解耦）
 * - VITE_ENABLE_API=true 時對接沙盒 2（門診閉環）
 */
export const SANDBOX_ID = "frontend-mock-v1" as const;

export const API_ENABLED =
  import.meta.env.VITE_ENABLE_API === "true" ||
  import.meta.env.VITE_ENABLE_API === "1";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const MOCK_DATA_ROOT = "@/mocks" as const;
