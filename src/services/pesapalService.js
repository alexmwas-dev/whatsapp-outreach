import axios from "axios";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

const DEFAULT_PESAPAL_BASE_URL = "https://cybqa.pesapal.com/pesapalv3";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
let cachedIpnId = process.env.PESAPAL_IPN_ID || null;

function getPesapalBaseUrl() {
  return (process.env.PESAPAL_BASE_URL || DEFAULT_PESAPAL_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function requirePesapalCredentials() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET?.trim();

  if (!consumerKey || !consumerSecret) {
    throw new AppError(
      "PesaPal credentials are not configured on the server",
      500,
    );
  }

  return { consumerKey, consumerSecret };
}

function resolveBackendPublicUrl() {
  const configured = process.env.BACKEND_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

function resolveFrontendUrl() {
  const configured = process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return "http://localhost:5173";
}

function withQueryParam(urlString, key, value) {
  try {
    const url = new URL(urlString);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return urlString;
  }
}

function toReadableValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveProviderErrorMessage(payload) {
  const candidates = [
    payload?.error?.message,
    payload?.error?.code,
    payload?.message,
    payload?.status_message,
    payload?.status,
    payload?.error,
  ];

  for (const candidate of candidates) {
    const readable = toReadableValue(candidate);
    if (readable) return readable;
  }

  return "";
}

async function requestAuthToken() {
  const { consumerKey, consumerSecret } = requirePesapalCredentials();
  try {
    const response = await axios.post(
      `${getPesapalBaseUrl()}/api/Auth/RequestToken`,
      {
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    const token =
      response?.data?.token ||
      response?.data?.access_token ||
      response?.data?.Token ||
      null;

    if (!token) {
      const providerMessage =
        resolveProviderErrorMessage(response?.data) ||
        "Token missing in auth response";

      logger.error("PesaPal auth response missing token", {
        meta: {
          baseUrl: getPesapalBaseUrl(),
          response: response?.data,
        },
      });

      throw new AppError(
        `Failed to get PesaPal access token: ${providerMessage}`,
        502,
      );
    }

    const expiryValue =
      response?.data?.expiryDate ||
      response?.data?.expiry_date ||
      response?.data?.expires_at ||
      null;
    const parsedExpiry = expiryValue ? new Date(expiryValue).getTime() : NaN;
    const safeExpiry = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : Date.now() + 4 * 60 * 1000;

    cachedAccessToken = token;
    cachedAccessTokenExpiresAt = safeExpiry;

    return token;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error("PesaPal auth request failed", {
      meta: {
        baseUrl: getPesapalBaseUrl(),
        status: error?.response?.status,
        response: error?.response?.data,
        message: error?.message,
      },
    });

    const providerMessage =
      resolveProviderErrorMessage(error?.response?.data) ||
      error?.message ||
      "Auth request failed";

    throw new AppError(
      `Failed to get PesaPal access token: ${providerMessage}`,
      502,
    );
  }
}

async function getAccessToken(forceRefresh = false) {
  const tokenStillValid =
    cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 30 * 1000;

  if (!forceRefresh && tokenStillValid) {
    return cachedAccessToken;
  }

  return requestAuthToken();
}

async function pesapalRequest({
  method,
  path,
  data,
  params,
  forceRefreshToken,
}) {
  const token = await getAccessToken(Boolean(forceRefreshToken));

  try {
    const response = await axios({
      method,
      baseURL: getPesapalBaseUrl(),
      url: path,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    if (
      !forceRefreshToken &&
      error?.response?.status === 401 &&
      process.env.PESAPAL_CONSUMER_KEY &&
      process.env.PESAPAL_CONSUMER_SECRET
    ) {
      return pesapalRequest({
        method,
        path,
        data,
        params,
        forceRefreshToken: true,
      });
    }

    logger.error("PesaPal request failed", {
      meta: {
        path,
        method,
        status: error?.response?.status,
        response: error?.response?.data,
        message: error?.message,
      },
    });

    throw new AppError("Failed to communicate with PesaPal", 502);
  }
}

async function ensureIpnId() {
  if (cachedIpnId) return cachedIpnId;

  const ipnUrl =
    process.env.PESAPAL_IPN_URL ||
    `${resolveBackendPublicUrl()}/billing/pesapal/webhook`;

  const response = await pesapalRequest({
    method: "POST",
    path: "/api/URLSetup/RegisterIPN",
    data: {
      url: ipnUrl,
      ipn_notification_type: "POST",
    },
  });

  const ipnId = response?.ipn_id || response?.ipnId || response?.id || null;

  if (!ipnId) {
    throw new AppError("Failed to register PesaPal IPN URL", 502);
  }

  cachedIpnId = String(ipnId);
  return cachedIpnId;
}

function resolveCallbackUrl(merchantReference) {
  const explicit = process.env.PESAPAL_CALLBACK_URL;
  const fallback = `${resolveBackendPublicUrl()}/billing/pesapal/callback`;
  const base = explicit || fallback;

  return withQueryParam(base, "merchantReference", merchantReference);
}

function maskSecret(value, visibleStart = 4, visibleEnd = 2) {
  const raw = String(value || "");
  if (!raw) return null;
  if (raw.length <= visibleStart + visibleEnd) return "*".repeat(raw.length);
  return `${raw.slice(0, visibleStart)}${"*".repeat(raw.length - visibleStart - visibleEnd)}${raw.slice(-visibleEnd)}`;
}

function describeSecret(rawValue, visibleStart = 4, visibleEnd = 2) {
  const raw =
    rawValue === undefined || rawValue === null ? "" : String(rawValue);
  const trimmed = raw.trim();
  const configured = Boolean(trimmed);

  return {
    configured,
    preview: configured ? maskSecret(trimmed, visibleStart, visibleEnd) : null,
    length: configured ? trimmed.length : 0,
    hasLeadingOrTrailingWhitespace: Boolean(raw) && raw !== trimmed,
  };
}

export function getPesapalConfigSnapshot() {
  const baseUrl = getPesapalBaseUrl();
  const backendPublicUrl = resolveBackendPublicUrl();
  const frontendUrl = resolveFrontendUrl();

  const callbackUrl =
    process.env.PESAPAL_CALLBACK_URL ||
    `${backendPublicUrl}/billing/pesapal/callback`;
  const ipnUrl =
    process.env.PESAPAL_IPN_URL ||
    `${backendPublicUrl}/billing/pesapal/webhook`;

  const consumerKey = describeSecret(process.env.PESAPAL_CONSUMER_KEY, 6, 2);
  const consumerSecret = describeSecret(
    process.env.PESAPAL_CONSUMER_SECRET,
    2,
    2,
  );

  const warnings = [];

  if (!consumerKey.configured) {
    warnings.push("PESAPAL_CONSUMER_KEY is missing");
  }
  if (!consumerSecret.configured) {
    warnings.push("PESAPAL_CONSUMER_SECRET is missing");
  }
  if (consumerKey.hasLeadingOrTrailingWhitespace) {
    warnings.push("PESAPAL_CONSUMER_KEY has leading/trailing whitespace");
  }
  if (consumerSecret.hasLeadingOrTrailingWhitespace) {
    warnings.push("PESAPAL_CONSUMER_SECRET has leading/trailing whitespace");
  }
  if (/localhost|127\.0\.0\.1/i.test(backendPublicUrl)) {
    warnings.push(
      "BACKEND_PUBLIC_URL is local; webhook/callback will fail from external providers",
    );
  }

  return {
    baseUrl,
    backendPublicUrl,
    frontendUrl,
    callbackUrl,
    ipnUrl,
    ipnIdConfigured: Boolean(process.env.PESAPAL_IPN_ID),
    credentials: {
      consumerKey,
      consumerSecret,
    },
    warnings,
  };
}

export async function getPesapalHealth({
  forceRefreshToken = false,
  ensureIpn = true,
} = {}) {
  const baseUrl = getPesapalBaseUrl();
  const backendPublicUrl = resolveBackendPublicUrl();
  const frontendUrl = resolveFrontendUrl();

  const ipnWebhookUrl =
    process.env.PESAPAL_IPN_URL ||
    `${resolveBackendPublicUrl()}/billing/pesapal/webhook`;
  const callbackUrl =
    process.env.PESAPAL_CALLBACK_URL ||
    `${resolveBackendPublicUrl()}/billing/pesapal/callback`;

  const health = {
    ok: false,
    baseUrl,
    backendPublicUrl,
    frontendUrl,
    credentials: {
      configured: false,
      keyPreview: null,
      secretPreview: null,
    },
    token: {
      checked: false,
      ok: false,
      expiresAt: null,
      error: null,
    },
    ipn: {
      checked: false,
      ok: false,
      id: cachedIpnId || process.env.PESAPAL_IPN_ID || null,
      webhookUrl: ipnWebhookUrl,
      callbackUrl,
      error: null,
    },
    issues: [],
  };

  try {
    const { consumerKey, consumerSecret } = requirePesapalCredentials();
    health.credentials.configured = true;
    health.credentials.keyPreview = maskSecret(consumerKey);
    health.credentials.secretPreview = maskSecret(consumerSecret, 2, 2);
  } catch (error) {
    health.issues.push(error?.message || "PesaPal credentials are missing");
    return health;
  }

  health.token.checked = true;
  try {
    const token = await getAccessToken(Boolean(forceRefreshToken));
    health.token.ok = Boolean(token);
    health.token.expiresAt = cachedAccessTokenExpiresAt
      ? new Date(cachedAccessTokenExpiresAt).toISOString()
      : null;
  } catch (error) {
    health.token.ok = false;
    health.token.error = error?.message || "Failed to retrieve token";
    health.issues.push(health.token.error);
  }

  if (!ensureIpn) {
    health.ipn.ok = Boolean(health.ipn.id);
    health.ok = health.credentials.configured && health.token.ok;
    return health;
  }

  health.ipn.checked = true;
  try {
    const ipnId = await ensureIpnId();
    health.ipn.id = ipnId;
    health.ipn.ok = Boolean(ipnId);
  } catch (error) {
    health.ipn.ok = false;
    health.ipn.error = error?.message || "Failed to configure IPN";
    health.issues.push(health.ipn.error);
  }

  health.ok =
    health.credentials.configured &&
    health.token.ok &&
    (!ensureIpn || health.ipn.ok);

  return health;
}

export async function createPesapalOrder({
  merchantReference,
  amount,
  currency,
  description,
  customerEmail,
  customerPhone,
  customerFirstName,
  customerLastName,
}) {
  const notificationId = await ensureIpnId();

  const payload = {
    id: merchantReference,
    currency: String(currency || "USD").toUpperCase(),
    amount: Number(amount),
    description: description || "Subscription payment",
    callback_url: resolveCallbackUrl(merchantReference),
    notification_id: notificationId,
    billing_address: {
      email_address: customerEmail || "billing@example.com",
      phone_number: customerPhone || "",
      country_code: process.env.PESAPAL_COUNTRY_CODE || "KE",
      first_name: customerFirstName || "Customer",
      last_name: customerLastName || "User",
      line_1: process.env.PESAPAL_BILLING_LINE1 || "N/A",
      city: process.env.PESAPAL_BILLING_CITY || "Nairobi",
      state: process.env.PESAPAL_BILLING_STATE || "Nairobi",
      postal_code: process.env.PESAPAL_BILLING_POSTAL_CODE || "00100",
      zip_code: process.env.PESAPAL_BILLING_ZIP_CODE || "00100",
    },
  };

  const response = await pesapalRequest({
    method: "POST",
    path: "/api/Transactions/SubmitOrderRequest",
    data: payload,
  });

  const orderTrackingId =
    response?.order_tracking_id || response?.orderTrackingId || null;
  const redirectUrl = response?.redirect_url || response?.redirectUrl || null;

  if (!redirectUrl) {
    logger.error("PesaPal checkout response missing redirect URL", {
      meta: { response },
    });
    throw new AppError("Failed to initialize payment checkout", 502);
  }

  return {
    merchantReference,
    orderTrackingId,
    redirectUrl,
    rawResponse: response,
  };
}

export async function getPesapalTransactionStatus(orderTrackingId) {
  if (!orderTrackingId) {
    throw new AppError("orderTrackingId is required", 400);
  }

  return pesapalRequest({
    method: "GET",
    path: "/api/Transactions/GetTransactionStatus",
    params: {
      orderTrackingId,
    },
  });
}

export function mapPesapalStatusToPaymentStatus(statusPayload) {
  const raw = String(
    statusPayload?.payment_status_description ||
      statusPayload?.payment_status ||
      statusPayload?.status ||
      "",
  )
    .trim()
    .toUpperCase();

  if (
    raw.includes("COMPLETED") ||
    raw.includes("PAID") ||
    raw.includes("SUCCESS")
  ) {
    return "COMPLETED";
  }

  if (raw.includes("CANCEL")) {
    return "CANCELED";
  }

  if (
    raw.includes("FAILED") ||
    raw.includes("INVALID") ||
    raw.includes("REJECT") ||
    raw.includes("ERROR")
  ) {
    return "FAILED";
  }

  return "PENDING";
}

export function extractPesapalNotificationFields(payload = {}, query = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const params = query && typeof query === "object" ? query : {};

  const orderTrackingId =
    body.orderTrackingId ||
    body.order_tracking_id ||
    body.OrderTrackingId ||
    params.orderTrackingId ||
    params.order_tracking_id ||
    params.OrderTrackingId ||
    null;

  const merchantReference =
    body.merchantReference ||
    body.merchant_reference ||
    body.OrderMerchantReference ||
    params.merchantReference ||
    params.merchant_reference ||
    params.OrderMerchantReference ||
    params.merchantRef ||
    null;

  return {
    orderTrackingId: orderTrackingId ? String(orderTrackingId) : null,
    merchantReference: merchantReference ? String(merchantReference) : null,
  };
}

export function buildBillingReturnUrl({
  merchantReference,
  paymentStatus,
  paymentId,
}) {
  const frontendUrl = `${resolveFrontendUrl()}/settings`;

  const url = withQueryParam(frontendUrl, "tab", "billing");
  const withRef = withQueryParam(url, "paymentRef", merchantReference || "");
  const withStatus = withQueryParam(
    withRef,
    "paymentStatus",
    paymentStatus || "PENDING",
  );

  return withQueryParam(withStatus, "paymentId", paymentId || "");
}
