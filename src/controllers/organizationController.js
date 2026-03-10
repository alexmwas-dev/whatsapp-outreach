import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/logger.js";
import bcrypt from "bcryptjs";
import { sendInviteEmail } from "../lib/email.js";
import {
  getSubscriptionUsage,
  toSubscriptionSummary,
} from "../services/subscriptionService.js";

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
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

export const getWhatsAppConnection = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  const numbers = await prisma.whatsAppNumber.findMany({
    where: { organizationId: orgId },
  });

  res.status(200).json({
    organization: {
      businessId: organization.businessId || "",
      whatsappBusinessAccountId: organization.whatsappBusinessAccountId || "",
      whatsappStatus: organization.whatsappStatus || "",
    },
    numbers: numbers.map((n) => ({
      id: n.id,
      displayName: n.displayName,
      phoneNumber: n.phoneNumber,
      isPrimary: n.isPrimary,
    })),
  });
});

export const connectWhatsAppBusiness = catchAsync(async (req, res) => {

  const orgId = req.organization.id;

  const { code, wabaId, phoneNumberId } = req.body;

  if (!code || !wabaId) {
    throw new AppError("authorization code and wabaId are required", 400);
  }

  /*
  =========================
  Exchange Code For Access Token
  =========================
  */

  const tokenResp = await fetch(
    `https://graph.facebook.com/v24.0/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&code=${code}`
  );

  const tokenJson = await tokenResp.json().catch(() => ({}));

  if (!tokenResp.ok) {
    logger.error("Token exchange failed", { meta: tokenJson });
    throw new AppError("Failed to exchange authorization code", 500);
  }

  const accessToken = tokenJson.access_token;

  if (!accessToken) {
    throw new AppError("Access token missing from Meta response", 500);
  }

  /*
  =========================
  Subscribe Webhook
  =========================
  */

  const subscribeResp = await fetch(
    `https://graph.facebook.com/v24.0/${wabaId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const subscribeJson = await subscribeResp.json().catch(() => ({}));

  if (!subscribeResp.ok) {
    logger.warn("Webhook subscription failed", { meta: subscribeJson });
    throw new AppError("Failed to subscribe webhook", 502);
  }

  /*
  =========================
   Fetch Phone Numbers
  =========================
  */

  const numbersResp = await fetch(
    `https://graph.facebook.com/v24.0/${wabaId}/phone_numbers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const numbersJson = await numbersResp.json().catch(() => ({}));

  if (!numbersResp.ok) {
    logger.warn("Failed fetching phone numbers", { meta: numbersJson });
    throw new AppError("Failed to fetch phone numbers", 502);
  }

  const numbers = numbersJson.data || [];

  /*
  =========================
  Update Organization
  =========================
  */

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      whatsappBusinessAccountId: wabaId,
      whatsappStatus: "CONNECTED",
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      whatsappStepsCompleted: {
        push: ["WABA_CONNECTED", "WEBHOOK_CONFIGURED"],
      },
    },
  });

  /*
  =========================
   Save Numbers
  =========================
  */

  const createdNumbers = [];

  for (const num of numbers) {

    const phoneNumber = num.display_phone_number || num.phone_number;
    const phoneId = num.id;

    if (!phoneNumber || !phoneId) continue;

    const created = await prisma.whatsAppNumber.upsert({
      where: { phoneNumberId: phoneId },
      update: {
        displayName: num.verified_name || phoneNumber,
        active: true,
        accessToken,
      },
      create: {
        organizationId: orgId,
        phoneNumber,
        phoneNumberId: phoneId,
        displayName: num.verified_name || phoneNumber,
        accessToken,
        active: true,
        isPrimary: createdNumbers.length === 0,
      },
    });

    createdNumbers.push(created);
  }

  /*
  =========================
  Set Primary Number
  =========================
  */

  if (phoneNumberId) {

    const preferred = createdNumbers.find(
      (n) => n.phoneNumberId === phoneNumberId
    );

    if (preferred) {

      await prisma.whatsAppNumber.updateMany({
        where: { organizationId: orgId },
        data: { isPrimary: false },
      });

      await prisma.whatsAppNumber.update({
        where: { id: preferred.id },
        data: { isPrimary: true },
      });

    }

  }

  /*
  =========================
  SUCCESS RESPONSE
  =========================
  */

  logger.info("WhatsApp Business connected", {
    meta: {
      organizationId: orgId,
      wabaId,
      numbers: createdNumbers.length,
    },
  });

  res.status(200).json({
    status: "success",
    message: "WhatsApp Business connected successfully",
    data: {
      organization: updatedOrg,
      numbers: createdNumbers,
    },
  });

});




/**
 * Manual connect flow:
 * - user shares WABA + phone number with our business in Business Manager
 * - client sends IDs
 * - backend verifies visibility with system token, subscribes webhook, persists IDs
 * Body: { wabaId: string }
 */
export const manualConnectWhatsApp = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { wabaId } = req.body;

  if (!wabaId) {
    throw new AppError("wabaId is required", 400);
  }

  const systemToken =
    process.env.SYSTEM_USER_TOKEN || process.env.WHATSAPP_TOKEN;
  if (!systemToken) {
    throw new AppError(
      "SYSTEM_USER_TOKEN or WHATSAPP_TOKEN is required for manual setup",
      500,
    );
  }

  // 1) Verify token can access WABA
  const verifyResp = await fetch(
    `https://graph.facebook.com/v24.0/${wabaId}?fields=id,name`,
    {
      headers: {
        Authorization: `Bearer ${systemToken}`,
      },
    },
  );
  const verifyJson = await verifyResp.json().catch(() => ({}));
  if (!verifyResp.ok) {
    logger.warn("Manual connect: token cannot access WABA", {
      meta: verifyJson,
    });
    throw new AppError(
      "Could not access this WABA. Ask customer to share WABA with your business partner ID.",
      403,
    );
  }

  // 2) Fetch phone numbers under this WABA and pick one
  const phoneListResp = await fetch(
    `https://graph.facebook.com/v24.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    {
      headers: {
        Authorization: `Bearer ${systemToken}`,
      },
    },
  );
  const phoneListJson = await phoneListResp.json().catch(() => ({}));
  if (!phoneListResp.ok || !Array.isArray(phoneListJson?.data)) {
    logger.warn("Manual connect: failed fetching WABA phone numbers", {
      meta: phoneListJson,
    });
    throw new AppError(
      "Could not fetch phone numbers for this WABA. Ensure the number is shared with your business.",
      403,
    );
  }
  const sharedNumbers = phoneListJson.data;
  const selectedPhone = sharedNumbers.find(
    (n) => n?.id && (n?.display_phone_number || n?.phone_number),
  );
  if (!selectedPhone) {
    throw new AppError(
      "No phone numbers available on this WABA for your token access",
      403,
    );
  }
  const phoneNumberId = selectedPhone.id;
  const displayPhone =
    selectedPhone.display_phone_number || selectedPhone.phone_number;

  const result = await persistWhatsAppConnection({
    orgId,
    wabaId,
    accessToken: systemToken,
    preferredPhoneNumberId: phoneNumberId,
    providedPhoneNumbers: sharedNumbers.map((n) => ({
      id: n.id,
      display_phone_number: n.display_phone_number || n.phone_number || null,
      verified_name:
        n.verified_name || n.display_phone_number || n.phone_number || null,
    })),
  });

  res.status(200).json({
    status: "success",
    data: {
      ...result,
      selectedPhoneNumberId: phoneNumberId,
      selectedDisplayPhoneNumber: displayPhone,
    },
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

  const members = users.map((user) => {
    const [firstName, ...lastNameParts] = (user.name || "").trim().split(/\s+/);
    const lastName = lastNameParts.join(" ") || null;

    return {
      id: user.salesRep?.id || user.id,
      userId: user.id,
      email: user.email,
      firstName: firstName || null,
      lastName,
      role: user.role,
      status: "ACTIVE",
      joinedAt: user.createdAt,
    };
  });

  res.status(200).json({
    status: "success",
    data: {
      totalMembers: members.length,
      members,
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
        email: newUser.email,
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
  const { memberId } = req.params;
  const { role } = req.body;

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
  const { memberId } = req.params;

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
  const { contacts, name, phone, email, salesRepId, campaignId } = req.body;

  // Bulk create
  if (contacts && Array.isArray(contacts)) {
    // Only OWNER or ADMIN can perform bulk imports
    if (!["OWNER", "ADMIN"].includes(req.user.role)) {
      throw new AppError(
        "Only OWNER or ADMIN can import contacts in bulk",
        403,
      );
    }
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

    // If campaignId provided, link contacts to campaign (existing + newly created)
    let campaignAdded = 0;
    if (campaignId) {
      // Ensure campaign exists and belongs to org
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (!campaign || campaign.organizationId !== orgId) {
        throw new AppError(
          "Campaign not found or does not belong to this organization",
          400,
        );
      }

      const phones = prepared.map((c) => c.phone);
      const matchedContacts = await prisma.contact.findMany({
        where: { organizationId: orgId, phone: { in: phones } },
      });

      const campaignContactsData = matchedContacts.map((c) => ({
        campaignId,
        contactId: c.id,
      }));

      if (campaignContactsData.length > 0) {
        const ccResult = await prisma.campaignContact.createMany({
          data: campaignContactsData,
          skipDuplicates: true,
        });
        campaignAdded = ccResult.count || 0;
      }
    }

    res.status(201).json({
      status: "success",
      data: { created: result.count, campaignAdded },
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
 * GET ORGANIZATION CONTACTS
 * - OWNER/ADMIN: all org contacts
 * - SALES_REP: only contacts assigned to the sales rep
 */
export const getOrganizationContacts = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userRole = req.user.role;

  const filter = { organizationId: orgId };

  if (userRole === "SALES_REP") {
    const salesRep = await prisma.salesRep.findUnique({
      where: { userId: req.user.id },
    });

    if (!salesRep) {
      throw new AppError("Sales rep profile not found", 404);
    }

    filter.salesRepId = salesRep.id;
  }

  const contacts = await prisma.contact.findMany({
    where: filter,
    orderBy: { updatedAt: "desc" },
  });

  res.status(200).json({
    status: "success",
    data: {
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        status: contact.status,
        consent: contact.consent,
        converted: contact.converted,
        salesRepId: contact.salesRepId,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      })),
    },
  });
});

/**
 * UPDATE ORGANIZATION CONTACT
 */
export const updateOrganizationContact = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userRole = req.user.role;
  const { contactId } = req.params;
  const { name, phone, email, status, consent, salesRepId } = req.body;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new AppError("Contact not found", 404);
  }

  if (contact.organizationId !== orgId) {
    throw new AppError("Contact does not belong to this organization", 403);
  }

  if (userRole === "SALES_REP") {
    const salesRep = await prisma.salesRep.findUnique({
      where: { userId: req.user.id },
    });

    if (!salesRep || contact.salesRepId !== salesRep.id) {
      throw new AppError("You do not have access to this contact", 403);
    }
  }

  const updateData = {
    ...(name !== undefined && { name }),
    ...(phone !== undefined && { phone }),
    ...(email !== undefined && { email }),
    ...(status !== undefined && { status }),
    ...(consent !== undefined && { consent }),
    ...(userRole !== "SALES_REP" && salesRepId !== undefined
      ? { salesRepId }
      : {}),
  };

  const updated = await prisma.contact.update({
    where: { id: contactId },
    data: updateData,
  });

  res.status(200).json({
    status: "success",
    data: {
      contact: updated,
    },
  });
});

/**
 * DELETE ORGANIZATION CONTACT
 */
export const deleteOrganizationContact = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userRole = req.user.role;
  const { contactId } = req.params;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new AppError("Contact not found", 404);
  }

  if (contact.organizationId !== orgId) {
    throw new AppError("Contact does not belong to this organization", 403);
  }

  if (userRole === "SALES_REP") {
    const salesRep = await prisma.salesRep.findUnique({
      where: { userId: req.user.id },
    });

    if (!salesRep || contact.salesRepId !== salesRep.id) {
      throw new AppError("You do not have access to this contact", 403);
    }
  }

  await prisma.contact.delete({ where: { id: contactId } });

  res.status(200).json({
    status: "success",
    message: "Contact deleted successfully",
  });
});

/**
 * GET ORGANIZATION STATS & USAGE
 */
export const getOrganizationStats = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    org,
    contacts,
    campaigns,
    messages,
    messagesThisMonthFromMessages,
    messagesThisMonthFromCampaignSends,
    activeWhatsAppNumbers,
    activeTemplates,
    subscriptionUsage,
  ] = await Promise.all([
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
    prisma.message.count({
      where: { organizationId: orgId, createdAt: { gte: startOfMonth } },
    }),
    prisma.campaignContact.count({
      where: {
        sentAt: { gte: startOfMonth },
        campaign: { organizationId: orgId },
      },
    }),
    prisma.whatsAppNumber.count({
      where: { organizationId: orgId, active: true },
    }),
    prisma.whatsAppTemplate.count({
      where: { organizationId: orgId, active: true },
    }),
    getSubscriptionUsage(orgId),
  ]);

  const messagesThisMonth =
    (messagesThisMonthFromMessages ?? 0) +
    (messagesThisMonthFromCampaignSends ?? 0);

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

  const subscription = subscriptionUsage?.subscription || null;
  const subscriptionSummary = toSubscriptionSummary(subscription);

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
        messagesThisMonth,
        activeWhatsAppNumbers,
        activeTemplates,
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
      subscription: subscriptionSummary,
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
