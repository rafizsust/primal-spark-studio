export type ApiErrorKind =
  | "quota"
  | "rate_limited"
  | "credits"
  | "invalid_key"
  | "key_suspended"
  | "permission_denied"
  | "network"
  | "unauthorized"
  | "unknown";

export interface ApiErrorAction {
  label: string;
  href: string;
  external?: boolean;
}

export interface ApiErrorDescriptor {
  kind: ApiErrorKind;
  title: string;
  description: string;
  action?: ApiErrorAction;
  /** for console/debugging only (never show directly to users) */
  debug?: string;
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function extractEmbeddedJson(text: string): unknown | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function normalizeErrorText(text: string): string {
  return text
    .replace(/Edge function returned\s+\d+\s*:\s*/gi, "")
    .replace(/^Error\s*,\s*/i, "")
    .trim();
}

function inferKind(rawLower: string, jsonLower: string): ApiErrorKind {
  const combined = `${rawLower}\n${jsonLower}`;

  if (combined.includes("payment required") || combined.includes("402")) return "credits";
  if (combined.includes("too many requests") || combined.includes("429") || combined.includes("rate limit")) return "rate_limited";

  // Gemini-specific quota/billing
  if (
    combined.includes("quota") ||
    combined.includes("resource_exhausted") ||
    combined.includes("billing") ||
    combined.includes("insufficient quota")
  ) {
    return "quota";
  }

  if (
    combined.includes("api key") &&
    (combined.includes("not valid") || combined.includes("invalid") || combined.includes("api_key_invalid"))
  ) {
    return "invalid_key";
  }

  if (
    combined.includes("suspended") ||
    combined.includes("revoked") ||
    combined.includes("disabled")
  ) {
    return "key_suspended";
  }

  if (combined.includes("permission_denied") || combined.includes("403") || combined.includes("access denied")) {
    return "permission_denied";
  }

  if (
    combined.includes("failed to fetch") ||
    combined.includes("networkerror") ||
    combined.includes("network error") ||
    combined.includes("typeerror")
  ) {
    return "network";
  }

  if (combined.includes("401") || combined.includes("unauthorized") || combined.includes("jwt")) {
    return "unauthorized";
  }

  return "unknown";
}

function defaultActionForKind(kind: ApiErrorKind): ApiErrorAction | undefined {
  if (kind === "invalid_key" || kind === "key_suspended" || kind === "permission_denied" || kind === "quota") {
    return { label: "Open Settings", href: "/settings" };
  }

  if (kind === "rate_limited") {
    return { label: "Try again", href: "#" };
  }

  return undefined;
}

function titleForKind(kind: ApiErrorKind): string {
  switch (kind) {
    case "quota":
      return "API quota exceeded";
    case "rate_limited":
      return "Too many requests";
    case "credits":
      return "AI credits exhausted";
    case "invalid_key":
      return "Invalid API key";
    case "key_suspended":
      return "API key suspended";
    case "permission_denied":
      return "API access denied";
    case "network":
      return "Network error";
    case "unauthorized":
      return "Not authorized";
    default:
      return "Something went wrong";
  }
}

function descriptionForKind(kind: ApiErrorKind): string {
  switch (kind) {
    case "quota":
      return "Your Gemini API has reached its rate/quota limit. Please wait a few minutes and try again, or check your Google AI Studio billing/usage.";
    case "rate_limited":
      return "You’re sending requests too quickly. Please wait a moment and try again.";
    case "credits":
      return "AI credits are exhausted. Please add credits to continue.";
    case "invalid_key":
      return "Your Gemini API key is missing or invalid. Please update it in Settings.";
    case "key_suspended":
      return "Your Gemini API key appears suspended/disabled. Please replace it in Settings or re-enable it in Google AI Studio.";
    case "permission_denied":
      return "Your API key doesn’t have permission to use this feature/model. Please check your Google AI Studio project settings.";
    case "network":
      return "We couldn’t reach the AI service. Check your internet connection and try again.";
    case "unauthorized":
      return "Your session is not authorized. Please sign in again and retry.";
    default:
      return "Please try again. If the problem persists, update your API key in Settings.";
  }
}

/**
 * Converts any thrown error (Supabase invoke, fetch, edge function JSON, etc.)
 * into a clean, user-friendly message (no raw non-2xx strings).
 */
export function describeApiError(err: unknown): ApiErrorDescriptor {
  const msg =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : safeString((err as any)?.message ?? (err as any)?.error ?? err);

  const embedded = extractEmbeddedJson(msg);

  const embeddedMsg =
    embedded && typeof embedded === "object"
      ? safeString((embedded as any).error ?? (embedded as any).message ?? embedded)
      : "";

  const rawText = normalizeErrorText(msg);
  const combinedForDetect = `${rawText}\n${embeddedMsg}`.trim();

  const kind = inferKind(combinedForDetect.toLowerCase(), safeString(embedded).toLowerCase());

  // If edge function returned a very specific message (e.g., "SUBMISSION_NOT_FOUND"), keep it as debug only.
  return {
    kind,
    title: titleForKind(kind),
    description: descriptionForKind(kind),
    action: defaultActionForKind(kind),
    debug: combinedForDetect || undefined,
  };
}
