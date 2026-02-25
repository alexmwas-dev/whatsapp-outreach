-- CreateTable
CREATE TABLE "BillingPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "messageLimit" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "periodDays" INTEGER NOT NULL DEFAULT 30,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_code_key" ON "BillingPlan"("code");

-- CreateIndex
CREATE INDEX "BillingPlan_active_sortOrder_idx" ON "BillingPlan"("active", "sortOrder");

-- Seed default plans
INSERT INTO "BillingPlan" (
  "id",
  "code",
  "name",
  "description",
  "messageLimit",
  "amount",
  "currency",
  "periodDays",
  "active",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'plan_free',
    'FREE',
    'Free',
    '100 monthly messages',
    100,
    0,
    'USD',
    30,
    true,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_starter',
    'STARTER',
    'Starter',
    '1,000 monthly messages',
    1000,
    69,
    'USD',
    30,
    true,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_growth',
    'GROWTH',
    'Growth',
    '5,000 monthly messages',
    5000,
    115,
    'USD',
    30,
    true,
    2,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_scale',
    'SCALE',
    'Scale',
    '20,000 monthly messages',
    20000,
    184,
    'USD',
    30,
    true,
    3,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;
