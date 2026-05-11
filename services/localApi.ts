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
    const trimmed = text.trim();
    if (/PayloadTooLargeError|request entity too large/i.test(trimmed)) {
      return "요청 자료가 너무 커서 로컬 API가 받지 못했어. 더 작은 파일을 쓰거나 LOCAL_API_JSON_LIMIT 값을 올린 뒤 서버를 다시 시작해줘.";
    }
    if (trimmed) return trimmed;
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
