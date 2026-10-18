const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function handleResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw data;
  }
  return data;
}

export async function api<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    ...init,
  });

  if (res.status === 401) {
    if (
      typeof window !== "undefined" &&
      path !== "/api/auth/me" &&
      !window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/register") &&
      window.location.pathname !== "/"
    ) {
      window.location.href = "/login";
    }
    throw { error: { code: "UNAUTHENTICATED", message: "Unauthenticated" } };
  }

  return handleResponse(res);
}

export const apiGet = <T = any>(path: string) => api<T>(path);

export const apiPost = <T = any>(path: string, body?: any) =>
  api<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });

export const apiPut = <T = any>(path: string, body?: any) =>
  api<T>(path, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
  });

export const apiDelete = <T = any>(path: string) =>
  api<T>(path, { method: "DELETE" });