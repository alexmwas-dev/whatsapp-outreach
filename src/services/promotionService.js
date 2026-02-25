import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

const PROMOTION_USAGE_STATUSES = ["PENDING", "COMPLETED"];

function toCurrencyCode(value) {
  return String(value || "USD")
    .trim()
    .toUpperCase();
}

function buildPricing(plan, discountAmount = 0) {
  const baseAmount = Math.max(0, Number(plan?.amount || 0));
  const normalizedDiscount = Math.min(
    baseAmount,
    Math.max(0, Math.round(Number(discountAmount) || 0)),
  );

  return {
    baseAmount,
    discountAmount: normalizedDiscount,
    finalAmount: Math.max(0, baseAmount - normalizedDiscount),
    currency: toCurrencyCode(plan?.currency),
  };
}

function toInvalidPromotionResult({ code = null, reason, plan }) {
  return {
    valid: false,
    code,
    reason,
    promotion: null,
    pricing: buildPricing(plan, 0),
  };
}

function computeDiscountAmount({ plan, promotion }) {
  const baseAmount = Math.max(0, Number(plan?.amount || 0));
  const discountValue = Number(promotion?.discountValue);

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return 0;
  }

  if (promotion.discountType === "PERCENTAGE") {
    if (discountValue > 100) return 0;
    return Math.round((baseAmount * discountValue) / 100);
  }

  return Math.round(discountValue);
}

export function normalizePromotionCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function toPromotionResponse(promotion) {
  if (!promotion) return null;

  return {
    id: promotion.id,
    code: promotion.code,
    description: promotion.description,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
    active: promotion.active,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    maxUses: promotion.maxUses,
  };
}

export async function evaluatePromotionCode({
  promoCode,
  plan,
  tx = prisma,
}) {
  const normalizedCode = normalizePromotionCode(promoCode);

  if (!normalizedCode) {
    return toInvalidPromotionResult({
      reason: "Enter a promotion code.",
      plan,
    });
  }

  const promotion = await tx.promotion.findUnique({
    where: { code: normalizedCode },
  });

  if (!promotion) {
    return toInvalidPromotionResult({
      code: normalizedCode,
      reason: "Invalid promotion code.",
      plan,
    });
  }

  if (!promotion.active) {
    return toInvalidPromotionResult({
      code: normalizedCode,
      reason: "This promotion is not active.",
      plan,
    });
  }

  const now = new Date();

  if (promotion.startsAt && promotion.startsAt > now) {
    return toInvalidPromotionResult({
      code: normalizedCode,
      reason: "This promotion has not started yet.",
      plan,
    });
  }

  if (promotion.endsAt && promotion.endsAt < now) {
    return toInvalidPromotionResult({
      code: normalizedCode,
      reason: "This promotion has expired.",
      plan,
    });
  }

  if (promotion.maxUses !== null && promotion.maxUses !== undefined) {
    const usageCount = await tx.payment.count({
      where: {
        promotionId: promotion.id,
        status: { in: PROMOTION_USAGE_STATUSES },
      },
    });

    if (usageCount >= promotion.maxUses) {
      return toInvalidPromotionResult({
        code: normalizedCode,
        reason: "This promotion has reached its usage limit.",
        plan,
      });
    }
  }

  const discountAmount = computeDiscountAmount({ plan, promotion });

  if (discountAmount <= 0) {
    return toInvalidPromotionResult({
      code: normalizedCode,
      reason: "This promotion does not apply to the selected plan.",
      plan,
    });
  }

  return {
    valid: true,
    code: normalizedCode,
    reason: null,
    promotion,
    pricing: buildPricing(plan, discountAmount),
  };
}

export async function resolvePromotionForCheckout({
  promoCode,
  plan,
  tx = prisma,
}) {
  const normalizedCode = normalizePromotionCode(promoCode);
  if (!normalizedCode) {
    return {
      valid: false,
      code: null,
      reason: null,
      promotion: null,
      pricing: buildPricing(plan, 0),
    };
  }

  const evaluation = await evaluatePromotionCode({
    promoCode: normalizedCode,
    plan,
    tx,
  });

  if (!evaluation.valid || !evaluation.promotion) {
    throw new AppError(evaluation.reason || "Invalid promotion code.", 400);
  }

  return evaluation;
}
