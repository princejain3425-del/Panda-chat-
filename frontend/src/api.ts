// Simple API client with Bearer token support.

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BASE_URL) {
  console.warn("EXPO_PUBLIC_BACKEND_URL is not set");
}

export const API_BASE = BASE_URL;

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T = any>(
  path: string,
  opts: {
    method?: Method;
    token?: string | null;
    body?: any;
  } = {},
): Promise<T> {
  const { method = "GET", token, body } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.detail) || `Request failed: ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

// WebSocket URL derived from backend URL
export function getWsUrl(token: string): string {
  if (!BASE_URL) return "";
  const wsBase = BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/api/ws?token=${encodeURIComponent(token)}`;
}
