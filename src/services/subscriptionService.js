import { prisma } from "../lib/prisma.js";

const DEFAULT_BILLING_PLANS = [
  {
    code: "FREE",
    name: "Free",
    description: "100 monthly messages",
    messageLimit: 100,
    amount: 0,
    currency: "USD",
    periodDays: 30,
    active: true,
    sortOrder: 0,
  },
  {
    code: "STARTER",
    name: "Starter",
    description: "1,000 monthly messages",
    messageLimit: 1000,
    amount: 69,
    currency: "USD",
    periodDays: 30,
    active: true,
    sortOrder: 1,
  },
  {
    code: "GROWTH",
    name: "Growth",
    description: "5,000 monthly messages",
    messageLimit: 5000,
    amount: 115,
    currency: "USD",
    periodDays: 30,
    active: true,
    sortOrder: 2,
  },
  {
    code: "SCALE",
    name: "Scale",
    description: "20,000 monthly messages",
    messageLimit: 20000,
    amount: 184,
    currency: "USD",
    periodDays: 30,
    active: true,
    sortOrder: 3,
  },
];

const DEFAULT_BILLING_PLANS_BY_CODE = Object.fromEntries(
  DEFAULT_BILLING_PLANS.map((plan) => [plan.code, plan]),
);

const SENDABLE_STATUSES = new Set(["TRIAL", "ACTIVE"]);

function addDays(from, days) {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizePlanCode(planCode) {
  return String(planCode || "")
    .trim()
    .toUpperCase();
}

function toPlanResponse(plan) {
  return {
    code: normalizePlanCode(plan.code),
    name: plan.name,
    description: plan.description,
    messageLimit: Number(plan.messageLimit || 0),
    amount: Number(plan.amount || 0),
    currency: String(plan.currency || "USD").toUpperCase(),
    periodDays: Number(plan.periodDays || 30),
  };
}

function isMissingBillingPlanSchemaError(error) {
  return error?.code === "P2021" || error?.code === "P2022";
}

function hasBillingPlanDelegate(tx = prisma) {
  return Boolean(
    tx?.billingPlan &&
      typeof tx.billingPlan.findMany === "function" &&
      typeof tx.billingPlan.findFirst === "function",
  );
}

function getDefaultPlanByCode(planCode) {
  const normalized = normalizePlanCode(planCode);
  const plan = DEFAULT_BILLING_PLANS_BY_CODE[normalized];
  return plan ? toPlanResponse(plan) : null;
}

async function seedDefaultPlans(tx = prisma) {
  if (!hasBillingPlanDelegate(tx)) return;

  await tx.billingPlan.createMany({
    data: DEFAULT_BILLING_PLANS.map((plan) => ({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      messageLimit: plan.messageLimit,
      amount: plan.amount,
      currency: plan.currency,
      periodDays: plan.periodDays,
      active: plan.active,
      sortOrder: plan.sortOrder,
    })),
    skipDuplicates: true,
  });
}

export async function getPlanCatalog(tx = prisma) {
  if (!hasBillingPlanDelegate(tx)) {
    return DEFAULT_BILLING_PLANS.map(toPlanResponse);
  }

  try {
    let plans = await tx.billingPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { amount: "asc" }, { createdAt: "asc" }],
    });

    if (plans.length === 0) {
      await seedDefaultPlans(tx);
      plans = await tx.billingPlan.findMany({
        where: { active: true },
        orderBy: [
          { sortOrder: "asc" },
          { amount: "asc" },
          { createdAt: "asc" },
        ],
      });
    }

    if (plans.length === 0) {
      return DEFAULT_BILLING_PLANS.map(toPlanResponse);
    }

    return plans.map(toPlanResponse);
  } catch (error) {
    if (isMissingBillingPlanSchemaError(error)) {
      return DEFAULT_BILLING_PLANS.map(toPlanResponse);
    }
    throw error;
  }
}

export async function getPlanByCode(planCode, tx = prisma) {
  const normalizedCode = normalizePlanCode(planCode);
  if (!normalizedCode) return null;
  if (!hasBillingPlanDelegate(tx)) return getDefaultPlanByCode(normalizedCode);

  try {
    const plan = await tx.billingPlan.findFirst({
      where: {
        code: normalizedCode,
        active: true,
      },
    });

    if (plan) return toPlanResponse(plan);

    const plans = await getPlanCatalog(tx);
    return plans.find((item) => item.code === normalizedCode) || null;
  } catch (error) {
    if (isMissingBillingPlanSchemaError(error)) {
      return getDefaultPlanByCode(normalizedCode);
    }
    throw error;
  }
}

async function ensureSubscriptionRecord(organizationId, tx = prisma) {
  const existing = await tx.subscription.findUnique({
    where: { organizationId },
  });

  if (existing) return existing;

  const now = new Date();
  const freePlan = (await getPlanByCode("FREE", tx)) || getDefaultPlanByCode("FREE");
  if (!freePlan) throw new Error("FREE billing plan not configured");

  try {
    return await tx.subscription.create({
      data: {
        organizationId,
        status: "TRIAL",
        plan: freePlan.code,
        messageLimit: freePlan.messageLimit,
        messagesUsed: 0,
        currentPeriodStart: now,
        currentPeriodEnd: addDays(now, freePlan.periodDays),
        provider: "trial",
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return tx.subscription.findUnique({
        where: { organizationId },
      });
    }
    throw error;
  }
}

async function refreshSubscriptionIfNeeded(subscription, tx = prisma) {
  if (!subscription) return subscription;

  const now = new Date();
  if (subscription.currentPeriodEnd > now) return subscription;

  const plan = await getPlanByCode(subscription.plan, tx);
  const isFreePlan = !plan || normalizePlanCode(subscription.plan) === "FREE";

  // Free tier auto-renews monthly. Paid tiers move to PAST_DUE until renewed.
  if (!isFreePlan) {
    return tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "PAST_DUE",
        providerRef: null,
      },
    });
  }

  return tx.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "TRIAL",
      messagesUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, plan?.periodDays || 30),
      provider: "trial",
      providerRef: null,
    },
  });
}

export async function getSubscriptionUsage(organizationId) {
  let subscription = await ensureSubscriptionRecord(organizationId);
  if (!subscription) throw new Error("Unable to initialize subscription");
  subscription = await refreshSubscriptionIfNeeded(subscription);

  const remaining = Math.max(
    0,
    Number(subscription.messageLimit || 0) -
      Number(subscription.messagesUsed || 0),
  );

  return {
    subscription,
    remaining,
    canSend: SENDABLE_STATUSES.has(subscription.status) && remaining > 0,
  };
}

export async function reserveMessageQuota({ organizationId, amount = 1 }) {
  const units = Math.max(1, Number(amount) || 1);

  return prisma.$transaction(async (tx) => {
    let subscription = await ensureSubscriptionRecord(organizationId, tx);
    if (!subscription) throw new Error("Unable to initialize subscription");
    subscription = await refreshSubscriptionIfNeeded(subscription, tx);

    const remaining = Math.max(
      0,
      Number(subscription.messageLimit || 0) -
        Number(subscription.messagesUsed || 0),
    );

    if (!SENDABLE_STATUSES.has(subscription.status)) {
      return {
        ok: false,
        reason: "SUBSCRIPTION_INACTIVE",
        subscription,
        remaining,
      };
    }

    if (remaining < units) {
      return {
        ok: false,
        reason: "LIMIT_REACHED",
        subscription,
        remaining,
      };
    }

    const maxUsedBeforeReserve = Number(subscription.messageLimit || 0) - units;

    const reserved = await tx.subscription.updateMany({
      where: {
        id: subscription.id,
        status: { in: ["TRIAL", "ACTIVE"] },
        currentPeriodEnd: { gt: new Date() },
        messagesUsed: { lte: maxUsedBeforeReserve },
      },
      data: {
        messagesUsed: { increment: units },
      },
    });

    if (reserved.count === 0) {
      const fresh = await tx.subscription.findUnique({
        where: { id: subscription.id },
      });

      const freshRemaining = Math.max(
        0,
        Number(fresh?.messageLimit || subscription.messageLimit || 0) -
          Number(fresh?.messagesUsed || subscription.messagesUsed || 0),
      );

      return {
        ok: false,
        reason: "LIMIT_REACHED",
        subscription: fresh || subscription,
        remaining: freshRemaining,
      };
    }

    const updated = await tx.subscription.findUnique({
      where: { id: subscription.id },
    });

    return {
      ok: true,
      reason: null,
      subscription: updated || subscription,
      remaining: Math.max(
        0,
        Number(updated?.messageLimit || subscription.messageLimit || 0) -
          Number(updated?.messagesUsed || subscription.messagesUsed || 0),
      ),
    };
  });
}

export async function releaseReservedMessageQuota({
  organizationId,
  amount = 1,
}) {
  const units = Math.max(1, Number(amount) || 1);

  await prisma.subscription.updateMany({
    where: {
      organizationId,
      messagesUsed: { gte: units },
    },
    data: {
      messagesUsed: { decrement: units },
    },
  });
}

export async function applyPaidSubscription({
  organizationId,
  planCode,
  provider = "pesapal",
  providerRef,
  tx = prisma,
}) {
  const plan = await getPlanByCode(planCode, tx);
  if (!plan) throw new Error("Invalid plan code");

  const now = new Date();
  const periodEnd = addDays(now, plan.periodDays);

  const subscription = await tx.subscription.upsert({
    where: { organizationId },
    update: {
      status: "ACTIVE",
      plan: plan.code,
      messageLimit: plan.messageLimit,
      messagesUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      provider,
      providerRef: providerRef || null,
    },
    create: {
      organizationId,
      status: "ACTIVE",
      plan: plan.code,
      messageLimit: plan.messageLimit,
      messagesUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      provider,
      providerRef: providerRef || null,
    },
  });

  await tx.organization.updateMany({
    where: { id: organizationId },
    data: { plan: plan.code },
  });

  return subscription;
}

export function toSubscriptionSummary(subscription) {
  if (!subscription) return null;

  const remaining = Math.max(
    0,
    Number(subscription.messageLimit || 0) -
      Number(subscription.messagesUsed || 0),
  );

  return {
    id: subscription.id,
    status: subscription.status,
    plan: subscription.plan,
    messageLimit: subscription.messageLimit,
    messagesUsed: subscription.messagesUsed,
    remaining,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    provider: subscription.provider,
    providerRef: subscription.providerRef,
  };
}

export function getQuotaErrorMessage(subscription) {
  if (!subscription) {
    return "No active subscription found for this organization.";
  }

  if (!SENDABLE_STATUSES.has(subscription.status)) {
    if (subscription.status === "PAST_DUE") {
      return "Your subscription is past due. Please renew to continue sending messages.";
    }

    if (subscription.status === "CANCELED") {
      return "Your subscription is canceled. Please activate a plan to continue sending messages.";
    }

    return "Your subscription is not active. Please update billing to continue.";
  }

  return "Monthly message limit reached. Upgrade your plan or wait for the next billing period.";
}

export { DEFAULT_BILLING_PLANS as BILLING_PLANS };
