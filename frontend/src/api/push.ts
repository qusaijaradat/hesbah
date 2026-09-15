import { apiClient } from "./client";

export interface PushStatusDto {
  /** The server has VAPID keys. False means the feature is off and there is nothing to offer. */
  enabled: boolean;
  publicKey: string | null;
  /** How many devices THIS user has registered — a phone and a tablet count as two. */
  deviceCount: number;
  /**
   * Whether this user's permissions reach ANY alert at all, decided by the server. False means
   * the app must not ASK — agreeing and then never hearing anything teaches somebody to refuse
   * the next thing this app asks for. The settings switch stays available to them either way.
   */
  receivesAny: boolean;
}

export async function pushStatus() {
  const { data } = await apiClient.get<PushStatusDto>("/push/status");
  return data;
}

/** The browser's own `subscription.toJSON()`, passed straight through. */
export async function pushSubscribe(payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}) {
  await apiClient.post("/push/subscribe", payload);
}

export async function pushUnsubscribe(endpoint: string) {
  await apiClient.post("/push/unsubscribe", { endpoint });
}

/** Sends one notification to this user's own devices now. Returns how many were accepted. */
export async function pushTest() {
  const { data } = await apiClient.post<number>("/push/test");
  return data;
}
