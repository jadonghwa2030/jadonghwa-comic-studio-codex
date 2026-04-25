type ApiErrorShape = { error?: { message?: string } };

const readErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as ApiErrorShape;
      const msg = typeof data?.error?.message === "string" ? data.error.message : "";
      if (msg.trim()) return msg.trim();
    } catch {
      // ignore
    }
  }
  try {
    const text = await response.text();
    if (text.trim()) return text.trim();
  } catch {
    // ignore
  }
  return `Request failed (${response.status})`;
};

export const getJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as T;
};

export const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as T;
};

