let csrfToken = "";

export function setHostedCsrf(token?: string | null) {
  csrfToken = typeof token === "string" ? token : "";
}

export function hostedHeaders(): Record<string, string> {
  return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
}
