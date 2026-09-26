/**
 * Talks to the Nokael backend exactly like the Android `SupabaseRpcClient`:
 * every function is `POST {base}/rest/v1/rpc/<name>` with a JSON body. The anon
 * key goes in the two headers (it only identifies the project); the driver's
 * session token travels in the body as `p_token` (added by [SessionRpc]).
 *
 * Deliberately silent: request and response bodies hold contact details and,
 * on login, the session token, so nothing here logs them.
 */

type Json = Record<string, unknown>;

export type RpcResult =
  /** HTTP success and `ok` was true (or absent). */
  | { type: "ok"; body: Json }
  /** HTTP 200 with `ok:false` — an expected business outcome such as `invalid_otp`. */
  | { type: "rejected"; error: string; body: Json }
  /** The token is missing, unknown, expired, revoked, or the driver was deactivated. */
  | { type: "invalid_session" }
  /** Anything else: no network, timeout, 5xx, unparseable body. Transient; retry manually. */
  | { type: "failure"; httpStatus?: number };

const TIMEOUT_MS = 20_000;

export class SupabaseRpcClient {
  private readonly rpcRoot: string;

  constructor(
    baseUrl: string,
    private readonly anonKey: string,
  ) {
    this.rpcRoot = baseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/";
  }

  async call(fn: string, params: Json = {}): Promise<RpcResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(this.rpcRoot + fn, {
        method: "POST",
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      return interpret(response.status, text);
    } catch {
      return { type: "failure" };
    } finally {
      clearTimeout(timer);
    }
  }
}

function interpret(status: number, text: string): RpcResult {
  let json: Json | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Json;
  } catch {
    json = null;
  }
  if (status >= 200 && status <= 299) {
    if (json == null) return { type: "failure", httpStatus: status };
    return json.ok === false
      ? { type: "rejected", error: typeof json.error === "string" ? json.error : "unknown", body: json }
      : { type: "ok", body: json };
  }
  // Session failures are matched on the error body, not the HTTP status.
  if (json && (json.message === "invalid_session" || json.code === "28000")) return { type: "invalid_session" };
  return { type: "failure", httpStatus: status };
}

/**
 * The driver's session token: in memory for cheap reads, persisted in
 * localStorage so it survives the PWA being closed. Treat it like a password:
 * never log it, never put it in a URL.
 */
export class SessionTokens {
  private static readonly KEY = "nokael.driver.session";
  private cached: string | null;

  constructor() {
    this.cached = safeRead(SessionTokens.KEY);
  }

  get = () => this.cached;

  set(token: string) {
    this.cached = token;
    safeWrite(SessionTokens.KEY, token);
  }

  clear() {
    this.cached = null;
    safeWrite(SessionTokens.KEY, null);
  }
}

/**
 * Calls for a signed-in driver: adds the session token as `p_token` (never in
 * the Authorization header) and handles `invalid_session` in one place.
 */
export class SessionRpc {
  constructor(
    private readonly rpc: SupabaseRpcClient,
    private readonly tokens: SessionTokens,
    private readonly onSessionInvalid: () => void,
  ) {}

  get hasSession() {
    return this.tokens.get() != null;
  }

  async call(fn: string, params: Json = {}): Promise<RpcResult> {
    const token = this.tokens.get();
    if (token == null) return { type: "invalid_session" };
    const result = await this.rpc.call(fn, { ...params, p_token: token });
    // Only react if the token that failed is still the current one; a slow
    // call from a previous session must not sign out a fresh login.
    if (result.type === "invalid_session" && this.tokens.get() === token) this.onSessionInvalid();
    return result;
  }
}

export function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeWrite(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / storage blocked: the app still works for this visit.
  }
}
