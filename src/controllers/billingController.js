import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import {
  createPesapalOrder,
  getPesapalConfigSnapshot,
  getPesapalTransactionStatus,
  mapPesapalStatusToPaymentStatus,
  extractPesapalNotificationFields,
  buildBillingReturnUrl,
  getPesapalHealth as getPesapalHealthCheck,
} from "../services/pesapalService.js";
import {
  getPlanCatalog,
  getPlanByCode,
  getSubscriptionUsage,
  toSubscriptionSummary,
  applyPaidSubscription,
} from "../services/subscriptionService.js";
import {
  evaluatePromotionCode,
  normalizePromotionCode,
  resolvePromotionForCheckout,
  toPromotionResponse,
} from "../services/promotionService.js";

function toPlanResponse(plan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    messageLimit: plan.messageLimit,
    amount: plan.amount,
    currency: plan.currency,
    periodDays: plan.periodDays,
  };
}

function toPaymentResponse(payment) {
  if (!payment) return null;

  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    planCode: payment.planCode,
    messageLimit: payment.messageLimit,
    periodDays: payment.periodDays,
    originalAmount:
      payment.originalAmount ??
      Number(payment.amount || 0) + Number(payment.discountAmount || 0),
    discountAmount: payment.discountAmount || 0,
    amount: payment.amount,
    currency: payment.currency,
    promotionCode: payment.promotionCode,
    promotion: payment.promotion ? toPromotionResponse(payment.promotion) : null,
    merchantReference: payment.merchantReference,
    orderTrackingId: payment.orderTrackingId,
    providerReference: payment.providerReference,
    paymentMethod: payment.paymentMethod,
    paymentAccount: payment.paymentAccount,
    paidAt: payment.paidAt,
    expiresAt: payment.expiresAt,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function buildMerchantReference(organizationId) {
  const compactOrg = String(organizationId || "org")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase();

  return `SUB-${compactOrg}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function toReadableFailureValue(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const readable = toReadableFailureValue(item);
      if (readable) return readable;
    }
    return "";
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "message",
      "code",
      "error_type",
      "errorType",
      "payment_status_code",
      "paymentStatusCode",
      "payment_status_description",
      "paymentStatusDescription",
      "status_message",
      "statusMessage",
      "description",
      "status",
    ];

    for (const key of preferredKeys) {
      const readable = toReadableFailureValue(value?.[key]);
      if (readable) return readable;
    }

    try {
      const json = JSON.stringify(value);
      return json === "{}" ? "" : json;
    } catch {
      return "";
    }
  }

  return "";
}

function resolveFailureReason(statusPayload) {
  const candidates = [
    statusPayload?.error,
    statusPayload?.payment_status_code,
    statusPayload?.payment_status_description,
    statusPayload?.status_message,
    statusPayload?.description,
    statusPayload?.message,
    statusPayload?.status,
  ];

  for (const candidate of candidates) {
    const readable = toReadableFailureValue(candidate);
    if (readable) return readable;
  }

  return null;
}

async function persistPaymentStatus({
  payment,
  paymentStatus,
  statusPayload,
  sourceOrderTrackingId,
}) {
  const orderTrackingId =
    sourceOrderTrackingId ||
    statusPayload?.order_tracking_id ||
    statusPayload?.orderTrackingId ||
    payment.orderTrackingId ||
    null;

  return prisma.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({
      where: { id: payment.id },
    });

    if (!current) {
      throw new AppError("Payment not found", 404);
    }

    const nextData = {
      status: paymentStatus,
      orderTrackingId: orderTrackingId || current.orderTrackingId,
      providerReference:
        statusPayload?.confirmation_code ||
        statusPayload?.confirmationCode ||
        current.providerReference,
      paymentMethod:
        statusPayload?.payment_method ||
        statusPayload?.paymentMethod ||
        current.paymentMethod,
      paymentAccount:
        statusPayload?.payment_account ||
        statusPayload?.paymentAccount ||
        current.paymentAccount,
      failureReason:
        paymentStatus === "FAILED" || paymentStatus === "CANCELED"
          ? resolveFailureReason(statusPayload)
          : null,
      paidAt:
        paymentStatus === "COMPLETED"
          ? current.paidAt || new Date()
          : current.paidAt,
      metadata: {
        ...(current.metadata && typeof current.metadata === "object"
          ? current.metadata
          : {}),
        lastStatusPayload: statusPayload,
      },
    };

    const updated = await tx.payment.update({
      where: { id: current.id },
      data: nextData,
    });

    let subscription = null;

    if (paymentStatus === "COMPLETED" && current.status !== "COMPLETED") {
      subscription = await applyPaidSubscription({
        organizationId: current.organizationId,
        planCode: current.planCode,
        provider: current.provider || "pesapal",
        providerRef: orderTrackingId || current.orderTrackingId,
        tx,
      });

      await tx.payment.update({
        where: { id: current.id },
        data: { subscriptionId: subscription.id },
      });
    }

    const refreshedPayment = await tx.payment.findUnique({
      where: { id: current.id },
    });

    return {
      payment: refreshedPayment || updated,
      subscription,
    };
  });
}

async function reconcilePayment({ orderTrackingId, merchantReference }) {
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        orderTrackingId ? { orderTrackingId } : undefined,
        merchantReference ? { merchantReference } : undefined,
      ].filter(Boolean),
    },
  });

  if (!payment) return null;

  const effectiveTrackingId = orderTrackingId || payment.orderTrackingId;

  if (!effectiveTrackingId) {
    return {
      payment,
      subscription: null,
      statusPayload: null,
    };
  }

  const statusPayload = await getPesapalTransactionStatus(effectiveTrackingId);
  const paymentStatus = mapPesapalStatusToPaymentStatus(statusPayload);

  return persistPaymentStatus({
    payment,
    paymentStatus,
    statusPayload,
    sourceOrderTrackingId: effectiveTrackingId,
  }).then((result) => ({
    ...result,
    statusPayload,
  }));
}

export const getBillingPlans = catchAsync(async (req, res) => {
  const plans = (await getPlanCatalog()).map(toPlanResponse);

  res.status(200).json({
    status: "success",
    data: { plans },
  });
});

export const getBillingOverview = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;

  const [usage, recentPayments, plans] = await Promise.all([
    getSubscriptionUsage(organizationId),
    prisma.payment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getPlanCatalog(),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      subscription: toSubscriptionSummary(usage.subscription),
      remainingMessages: usage.remaining,
      canSend: usage.canSend,
      plans: plans.map(toPlanResponse),
      payments: recentPayments.map(toPaymentResponse),
    },
  });
});

export const getPesapalHealth = catchAsync(async (req, res) => {
  const refreshQuery = String(req.query.refresh || "").toLowerCase();
  const ensureIpnQuery = String(req.query.ensureIpn || "").toLowerCase();

  const forceRefreshToken =
    refreshQuery === "1" || refreshQuery === "true" || refreshQuery === "yes";
  const ensureIpn = !(
    ensureIpnQuery === "0" ||
    ensureIpnQuery === "false" ||
    ensureIpnQuery === "no"
  );

  const health = await getPesapalHealthCheck({
    forceRefreshToken,
    ensureIpn,
  });

  res.status(200).json({
    status: "success",
    data: health,
  });
});

export const listBillingPromotions = catchAsync(async (req, res) => {
  const promotions = await prisma.promotion.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.status(200).json({
    status: "success",
    data: {
      promotions: promotions.map(toPromotionResponse),
    },
  });
});

export const createBillingPromotion = catchAsync(async (req, res) => {
  const normalizedCode = normalizePromotionCode(req.body.code);
  if (!normalizedCode) {
    throw new AppError("Promotion code is required", 400);
  }

  const discountType = String(req.body.discountType || "PERCENTAGE")
    .trim()
    .toUpperCase();
  if (discountType !== "PERCENTAGE" && discountType !== "FIXED") {
    throw new AppError("discountType must be PERCENTAGE or FIXED", 400);
  }

  const discountValue = Number(req.body.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new AppError("discountValue must be a positive number", 400);
  }

  if (discountType === "PERCENTAGE" && discountValue > 100) {
    throw new AppError("Percentage discount cannot exceed 100", 400);
  }

  let maxUses = null;
  if (req.body.maxUses !== undefined && req.body.maxUses !== null) {
    const parsedMaxUses = Number(req.body.maxUses);
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses <= 0) {
      throw new AppError("maxUses must be a positive integer", 400);
    }
    maxUses = parsedMaxUses;
  }

  const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new AppError("startsAt must be a valid date", 400);
  }

  const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new AppError("endsAt must be a valid date", 400);
  }

  if (startsAt && endsAt && startsAt > endsAt) {
    throw new AppError("startsAt must be before endsAt", 400);
  }

  try {
    const promotion = await prisma.promotion.create({
      data: {
        code: normalizedCode,
        description: req.body.description
          ? String(req.body.description).trim()
          : null,
        discountType,
        discountValue: Math.round(discountValue),
        active: req.body.active !== false,
        startsAt,
        endsAt,
        maxUses,
      },
    });

    res.status(201).json({
      status: "success",
      data: {
        promotion: toPromotionResponse(promotion),
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw new AppError("Promotion code already exists", 409);
    }
    throw error;
  }
});

export const validateBillingPromotion = catchAsync(async (req, res) => {
  const { planCode, promoCode } = req.body;
  const plan = await getPlanByCode(planCode);

  if (!plan) {
    throw new AppError("Invalid plan selected", 400);
  }

  if (plan.amount <= 0) {
    throw new AppError("Free plan does not require a promotion code", 400);
  }

  const evaluation = await evaluatePromotionCode({
    promoCode,
    plan,
  });

  res.status(200).json({
    status: "success",
    data: {
      valid: evaluation.valid,
      code: evaluation.code,
      reason: evaluation.reason,
      pricing: evaluation.pricing,
      promotion: toPromotionResponse(evaluation.promotion),
    },
  });
});

export const createBillingCheckout = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;
  const user = req.user;

  const { planCode, customerPhone, customerEmail, promoCode } = req.body;
  const plan = await getPlanByCode(planCode);

  if (!plan) {
    throw new AppError("Invalid plan selected", 400);
  }

  if (plan.amount <= 0) {
    throw new AppError("Free plan does not require payment", 400);
  }

  const promotionResult = await resolvePromotionForCheckout({
    promoCode,
    plan,
  });
  const pricing = promotionResult.pricing;
  const amountToCharge = pricing.finalAmount;
  const pesapalConfig = getPesapalConfigSnapshot();

  logger.info("Billing checkout initiated", {
    meta: {
      organizationId,
      userId: user.id,
      planCode: plan.code,
      amount: amountToCharge,
      baseAmount: pricing.baseAmount,
      discountAmount: pricing.discountAmount,
      currency: pricing.currency,
      promotionCode: promotionResult.code,
      pesapalConfig,
    },
  });

  const merchantReference = buildMerchantReference(organizationId);
  const basePaymentData = {
    organizationId,
    status: "PENDING",
    planCode: plan.code,
    messageLimit: plan.messageLimit,
    periodDays: plan.periodDays,
    amount: amountToCharge,
    originalAmount: pricing.baseAmount,
    discountAmount: pricing.discountAmount,
    currency: pricing.currency,
    promotionCode: promotionResult.code,
    promotionId: promotionResult.promotion?.id || null,
    merchantReference,
    metadata: {
      createdByUserId: user.id,
      pricing,
      promotion: toPromotionResponse(promotionResult.promotion),
    },
  };

  if (amountToCharge <= 0) {
    const completedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          ...basePaymentData,
          provider: "promotion",
          status: "COMPLETED",
          paidAt: completedAt,
          providerReference: promotionResult.code || null,
        },
      });

      const subscription = await applyPaidSubscription({
        organizationId,
        planCode: plan.code,
        provider: "promotion",
        providerRef: merchantReference,
        tx,
      });

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { subscriptionId: subscription.id },
      });

      return { payment: updatedPayment, subscription };
    });

    return res.status(201).json({
      status: "success",
      data: {
        payment: toPaymentResponse(result.payment),
        subscription: toSubscriptionSummary(result.subscription),
        redirectUrl: null,
      },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      provider: "pesapal",
      ...basePaymentData,
    },
  });

  try {
    const [firstName = "Customer", ...restNames] = String(user.name || "")
      .trim()
      .split(/\s+/);
    const lastName = restNames.join(" ") || "User";

    const checkout = await createPesapalOrder({
      merchantReference,
      amount: amountToCharge,
      currency: pricing.currency,
      description: `${plan.name} subscription for ${req.organization?.name || "organization"}`,
      customerEmail: customerEmail || user.email,
      customerPhone: customerPhone || null,
      customerFirstName: firstName,
      customerLastName: lastName,
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        orderTrackingId: checkout.orderTrackingId,
        metadata: {
          ...(payment.metadata && typeof payment.metadata === "object"
            ? payment.metadata
            : {}),
          checkout: checkout.rawResponse,
        },
      },
    });

    res.status(201).json({
      status: "success",
      data: {
        payment: toPaymentResponse(updated),
        redirectUrl: checkout.redirectUrl,
      },
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureReason: error?.message || "Failed to initialize checkout",
      },
    });

    throw error;
  }
});

export const listBillingPayments = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;

  const payments = await prisma.payment.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.status(200).json({
    status: "success",
    data: {
      payments: payments.map(toPaymentResponse),
    },
  });
});

export const getBillingPayment = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;
  const { paymentId } = req.params;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId },
  });

  if (!payment) throw new AppError("Payment not found", 404);

  res.status(200).json({
    status: "success",
    data: { payment: toPaymentResponse(payment) },
  });
});

export const verifyBillingPayment = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;
  const { paymentId } = req.params;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId },
  });

  if (!payment) throw new AppError("Payment not found", 404);
  if (!payment.orderTrackingId) {
    throw new AppError("Payment does not have a tracking ID yet", 400);
  }

  const statusPayload = await getPesapalTransactionStatus(
    payment.orderTrackingId,
  );
  const paymentStatus = mapPesapalStatusToPaymentStatus(statusPayload);

  const result = await persistPaymentStatus({
    payment,
    paymentStatus,
    statusPayload,
  });

  res.status(200).json({
    status: "success",
    data: {
      payment: toPaymentResponse(result.payment),
      subscription: toSubscriptionSummary(result.subscription),
    },
  });
});

export const cancelSubscription = catchAsync(async (req, res) => {
  const organizationId = req.user.organizationId;

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
  });

  if (!subscription) {
    throw new AppError("Subscription not found", 404);
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "CANCELED" },
  });

  res.status(200).json({
    status: "success",
    data: {
      subscription: toSubscriptionSummary(updated),
    },
  });
});

export const pesapalWebhook = catchAsync(async (req, res) => {
  const { orderTrackingId, merchantReference } =
    extractPesapalNotificationFields(req.body, req.query);

  if (!orderTrackingId && !merchantReference) {
    return res.status(200).json({
      status: 200,
      message: "No payment identifiers found",
    });
  }

  try {
    const reconciled = await reconcilePayment({
      orderTrackingId,
      merchantReference,
    });

    if (!reconciled) {
      logger.warn("PesaPal webhook payment not found", {
        meta: { orderTrackingId, merchantReference },
      });
    }
  } catch (error) {
    logger.error("Failed to reconcile PesaPal webhook", {
      meta: {
        orderTrackingId,
        merchantReference,
        error: error?.message,
      },
    });
  }

  res.status(200).json({
    status: 200,
    message: "Webhook received",
  });
});

export const pesapalCallback = catchAsync(async (req, res) => {
  const { orderTrackingId, merchantReference } =
    extractPesapalNotificationFields(req.query, req.query);

  let payment = null;
  let paymentStatus = "PENDING";

  try {
    const reconciled = await reconcilePayment({
      orderTrackingId,
      merchantReference,
    });

    if (reconciled?.payment) {
      payment = reconciled.payment;
      paymentStatus = reconciled.payment.status;
    }
  } catch (error) {
    logger.error("Failed to reconcile PesaPal callback", {
      meta: {
        orderTrackingId,
        merchantReference,
        error: error?.message,
      },
    });
    paymentStatus = "FAILED";
  }

  const returnUrl = buildBillingReturnUrl({
    merchantReference: merchantReference || payment?.merchantReference,
    paymentStatus,
    paymentId: payment?.id,
  });

  return res.redirect(returnUrl);
});
