import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import bcrypt from "bcryptjs";
import { sendInviteEmail } from "../lib/email.js";

/**
 * GET ORGANIZATION DETAILS
 */
export const createOrganization = catchAsync(async (req, res) => {
  const { name, slug, plan = "FREE" } = req.body;
  const userId = req.user.id; // Authenticated user

  if (!name || !slug) {
    throw new AppError("Organization name and slug are required", 400);
  }

  // Check slug uniqueness
  const existingOrg = await prisma.organization.findUnique({ where: { slug } });
  if (existingOrg) {
    throw new AppError("Organization slug already exists", 409);
  }

  // Check that user exists (optional, extra safety)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("Authenticated user not found", 404);
  }

  // Create organization and assign authenticated user as OWNER
  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        plan,
      },
    });

    // Update user role and link to org
    await tx.user.update({
      where: { id: userId },
      data: {
        role: "OWNER",
        organizationId: org.id,
      },
    });

    // Create free trial subscription
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        status: "TRIAL",
        plan: "FREE",
        messageLimit: 100,
        messagesUsed: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        provider: "trial",
      },
    });

    return org;
  });

  res.status(201).json({
    status: "success",
    data: { organization },
  });
});

export const connectWhatsAppBusiness = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { wabaId, webhookToken, displayName, tier } = req.body;

  if (!wabaId || !webhookToken || !tier) {
    throw new AppError(
      "WABA ID, access token, and messaging tier are required",
      400,
    );
  }

  // Update organization with WABA
  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      whatsappBusinessAccountId: wabaId,
      messagingTier: tier,
      webhookVerifyToken: webhookToken,
    },
  });

  res.status(200).json({
    status: "success",
    data: { organization: updatedOrg },
  });
});

export const getOrganization = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      },
      subscription: true,
      _count: {
        select: {
          contacts: true,
          campaigns: true,
          salesReps: true,
        },
      },
    },
  });

  if (!org) {
    throw new AppError("Organization not found", 404);
  }

  res.status(200).json({
    status: "success",
    data: {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      },
      stats: {
        totalUsers: org.users.length,
        totalContacts: org._count.contacts,
        totalCampaigns: org._count.campaigns,
        totalSalesReps: org._count.salesReps,
      },
      users: org.users,
      subscription: org.subscription,
    },
  });
});

/**
 * UPDATE ORGANIZATION SETTINGS
 */
export const updateOrganization = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { name } = req.body;

  // Check if user is OWNER or ADMIN
  if (!["OWNER", "ADMIN"].includes(req.user.role)) {
    throw new AppError("Only OWNER or ADMIN can update organization", 403);
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(name && { name }),
    },
    include: {
      subscription: true,
    },
  });

  logger.info("Organization updated", {
    meta: { organizationId: orgId, userId },
  });

  res.status(200).json({
    status: "success",
    data: {
      organization: updated,
    },
  });
});

/**
 * GET TEAM MEMBERS
 */
export const getTeamMembers = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      salesRep: {
        select: {
          id: true,
          phone: true,
          active: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  res.status(200).json({
    status: "success",
    data: {
      totalMembers: users.length,
      members: users,
    },
  });
});

/**
 * INVITE TEAM MEMBER
 */
export const inviteTeamMember = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const orgName = req.organization.name;
  const userId = req.user.id;
  const { email, name, role, phone } = req.body;

  if (!email || !name || !role) {
    throw new AppError("Email, name, and role are required", 400);
  }

  if (!["ADMIN", "SALES_REP"].includes(role)) {
    throw new AppError("Invalid role. Must be ADMIN or SALES_REP", 400);
  }

  if (!["OWNER", "ADMIN"].includes(req.user.role)) {
    throw new AppError("Only OWNER or ADMIN can invite team members", 403);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new AppError("A user with this email already exists.", 409);
  }

  const tempPassword = Math.random().toString(36).slice(-8);
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const newUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role,
      organizationId: orgId,
    },
  });

  if (role === "SALES_REP") {
    if (!phone) {
      throw new AppError("Phone number is required for sales reps", 400);
    }

    await prisma.salesRep.create({
      data: {
        name: newUser.name,
        phone,
        organizationId: orgId,
        userId: newUser.id,
      },
    });
  }

  // 📧 Send invite email
  try {
    await sendInviteEmail({
      to: email,
      name,
      orgName,
      tempPassword,
    });
  } catch (err) {
    // Important: user is created, email failed
    console.error("Failed to send invite email", err);
  }

  res.status(201).json({
    status: "success",
    message: "Team member invited successfully",
    data: {
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    },
  });
});

/**
 * UPDATE TEAM MEMBER ROLE
 */
export const updateTeamMemberRole = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { memberId, role } = req.body;

  // Validation
  if (!memberId || !role) {
    throw new AppError("Member ID and role are required", 400);
  }

  if (!["ADMIN", "SALES_REP"].includes(role)) {
    throw new AppError("Invalid role. Must be ADMIN or SALES_REP", 400);
  }

  // Check if user is OWNER or ADMIN
  if (!["OWNER", "ADMIN"].includes(req.user.role)) {
    throw new AppError("Only OWNER or ADMIN can update team member roles", 403);
  }

  // Prevent changing OWNER role
  const member = await prisma.user.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    throw new AppError("Team member not found", 404);
  }

  if (member.organizationId !== orgId) {
    throw new AppError("Team member does not belong to this organization", 403);
  }

  if (member.role === "OWNER") {
    throw new AppError("Cannot change OWNER role", 400);
  }

  // Cannot change your own role
  if (memberId === userId) {
    throw new AppError("Cannot change your own role", 400);
  }

  const updated = await prisma.user.update({
    where: { id: memberId },
    data: { role },
  });

  logger.info("Team member role updated", {
    meta: {
      memberId,
      newRole: role,
      updatedByUserId: userId,
      organizationId: orgId,
    },
  });

  res.status(200).json({
    status: "success",
    message: "Team member role updated successfully",
    data: {
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
      },
    },
  });
});

/**
 * REMOVE TEAM MEMBER
 */
export const removeTeamMember = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { memberId } = req.body;

  if (!memberId) {
    throw new AppError("Member ID is required", 400);
  }

  // Check if user is OWNER
  if (req.user.role !== "OWNER") {
    throw new AppError("Only OWNER can remove team members", 403);
  }

  // Fetch member
  const member = await prisma.user.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    throw new AppError("Team member not found", 404);
  }

  if (member.organizationId !== orgId) {
    throw new AppError("Team member does not belong to this organization", 403);
  }

  // Cannot remove OWNER
  if (member.role === "OWNER") {
    throw new AppError("Cannot remove OWNER", 400);
  }

  // Cannot remove yourself
  if (memberId === userId) {
    throw new AppError("Cannot remove yourself", 400);
  }

  // Delete user
  await prisma.user.delete({
    where: { id: memberId },
  });

  logger.info("Team member removed", {
    meta: {
      removedMemberId: memberId,
      removedByUserId: userId,
      organizationId: orgId,
    },
  });

  res.status(200).json({
    status: "success",
    message: "Team member removed successfully",
  });
});

/**
 * ADD CONTACTS TO ORGANIZATION
 * - Accepts either a single contact (name, phone, email, salesRepId)
 *   or an array under `contacts`.
 */
export const addContactsToOrganization = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { contacts, name, phone, email, salesRepId } = req.body;

  // Bulk create
  if (contacts && Array.isArray(contacts)) {
    const prepared = contacts.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email || null,
      salesRepId: c.salesRepId || null,
      organizationId: orgId,
    }));

    if (prepared.some((c) => !c.name || !c.phone)) {
      throw new AppError("Each contact requires name and phone", 400);
    }

    const result = await prisma.contact.createMany({
      data: prepared,
      skipDuplicates: true,
    });

    res.status(201).json({
      status: "success",
      data: { created: result.count },
    });
    return;
  }

  // Single create
  if (!name || !phone) {
    throw new AppError("name and phone are required", 400);
  }

  const contact = await prisma.contact.create({
    data: {
      name,
      phone,
      email: email || null,
      salesRepId: salesRepId || null,
      organizationId: orgId,
    },
  });

  res.status(201).json({ status: "success", data: contact });
});

/**
 * GET ORGANIZATION STATS & USAGE
 */
export const getOrganizationStats = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const [org, contacts, campaigns, messages, subscription] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
    }),
    prisma.contact.count({
      where: { organizationId: orgId },
    }),
    prisma.campaign.count({
      where: { organizationId: orgId },
    }),
    prisma.message.count({
      where: { organizationId: orgId },
    }),
    prisma.subscription.findUnique({
      where: { organizationId: orgId },
    }),
  ]);

  const messagesByDirection = await prisma.message.groupBy({
    by: ["direction"],
    where: { organizationId: orgId },
    _count: true,
  });

  const messagesByStatus = await prisma.contact.groupBy({
    by: ["status"],
    where: { organizationId: orgId },
    _count: true,
  });

  res.status(200).json({
    status: "success",
    data: {
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      usage: {
        totalContacts: contacts,
        totalCampaigns: campaigns,
        totalMessages: messages,
      },
      messageStats: {
        byDirection: messagesByDirection.map((item) => ({
          direction: item.direction,
          count: item._count,
        })),
        byContactStatus: messagesByStatus.map((item) => ({
          status: item.status,
          count: item._count,
        })),
      },
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.plan,
            messageLimit: subscription.messageLimit,
            messagesUsed: subscription.messagesUsed,
            remaining: subscription.messageLimit - subscription.messagesUsed,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
    },
  });
});

/**
 * GET ORGANIZATION ACTIVITY LOG
 */
export const getActivityLog = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { limit = 50, offset = 0 } = req.query;

  // Get recent messages (activity proxy)
  const activities = await prisma.message.findMany({
    where: { organizationId: orgId },
    include: {
      contact: {
        select: { name: true, phone: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: parseInt(limit),
    skip: parseInt(offset),
  });

  const total = await prisma.message.count({
    where: { organizationId: orgId },
  });

  res.status(200).json({
    status: "success",
    data: {
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      activities: activities.map((msg) => ({
        id: msg.id,
        type:
          msg.direction === "OUTBOUND" ? "MESSAGE_SENT" : "MESSAGE_RECEIVED",
        contactName: msg.contact.name,
        contactPhone: msg.contact.phone,
        timestamp: msg.createdAt,
      })),
    },
  });
});

/**
 * ADD SALES REP TO ORGANIZATION
 */
export const addSalesRep = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { userId, phone } = req.body;

  // Permissions
  if (!["OWNER", "ADMIN"].includes(req.user.role)) {
    throw new AppError("Only OWNER or ADMIN can add sales reps", 403);
  }

  if (!userId || !phone) {
    throw new AppError("User ID and phone are required", 400);
  }

  // Fetch user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { salesRep: true },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (user.organizationId !== orgId) {
    throw new AppError("User does not belong to this organization", 403);
  }

  if (user.role !== "SALES_REP") {
    throw new AppError("User must have SALES_REP role", 400);
  }

  if (user.salesRep) {
    throw new AppError("User is already a sales rep", 409);
  }

  // Create sales rep
  const salesRep = await prisma.salesRep.create({
    data: {
      phone,
      organizationId: orgId,
      userId: user.id,
    },
  });

  logger.info("Sales rep added", {
    meta: {
      salesRepId: salesRep.id,
      userId: user.id,
      organizationId: orgId,
    },
  });

  res.status(201).json({
    status: "success",
    message: "Sales rep added successfully",
    data: {
      salesRep: {
        id: salesRep.id,
        phone: salesRep.phone,
        active: salesRep.active,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
    },
  });
});
