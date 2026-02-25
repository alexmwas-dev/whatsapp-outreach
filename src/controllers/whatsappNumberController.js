import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";

/**
 * GET ALL WHATSAPP NUMBERS
 */
export const getWhatsAppNumbers = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      whatsappBusinessAccountId: true,
    },
  });

  const numbers = await prisma.whatsAppNumber.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      phoneNumber: true,
      phoneNumberId: true,
      displayName: true,
      active: true,
      isPrimary: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const [messageCounts, lastActiveByNumber] = await Promise.all([
    prisma.message.groupBy({
      by: ["whatsappNumberId", "direction"],
      where: { organizationId: orgId },
      _count: true,
    }),
    prisma.message.groupBy({
      by: ["whatsappNumberId"],
      where: { organizationId: orgId },
      _max: { createdAt: true },
    }),
  ]);

  const countsByNumber = messageCounts.reduce((acc, item) => {
    if (!acc[item.whatsappNumberId]) {
      acc[item.whatsappNumberId] = { sent: 0, received: 0 };
    }
    if (item.direction === "OUTBOUND") {
      acc[item.whatsappNumberId].sent = item._count;
    }
    if (item.direction === "INBOUND") {
      acc[item.whatsappNumberId].received = item._count;
    }
    return acc;
  }, {});

  const lastActiveMap = lastActiveByNumber.reduce((acc, item) => {
    acc[item.whatsappNumberId] = item._max?.createdAt || null;
    return acc;
  }, {});

  res.status(200).json({
    status: "success",
    data: {
      organization: {
        wabaConnected: Boolean(org?.whatsappBusinessAccountId),
        webhookConfigured: Boolean(process.env.WEBHOOK_VERIFY_TOKEN),
      },
      total: numbers.length,
      numbers: numbers.map((num) => ({
        id: num.id,
        phoneNumber: num.phoneNumber,
        displayName: num.displayName,
        isActive: num.active,
        isPrimary: num.isPrimary,
        messagesSent: countsByNumber[num.id]?.sent || 0,
        messagesReceived: countsByNumber[num.id]?.received || 0,
        lastActiveAt: lastActiveMap[num.id] || null,
        createdAt: num.createdAt,
      })),
    },
  });
});

/**
 * GET SINGLE WHATSAPP NUMBER
 */
export const getWhatsAppNumber = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { numberId } = req.params;

  const number = await prisma.whatsAppNumber.findUnique({
    where: { id: numberId },
  });

  if (!number) {
    throw new AppError("WhatsApp number not found", 404);
  }

  if (number.organizationId !== orgId) {
    throw new AppError(
      "This WhatsApp number does not belong to your organization",
      403,
    );
  }

  // Don't return accessToken to client
  const { accessToken, ...numberData } = number;

  res.status(200).json({
    status: "success",
    data: {
      number: numberData,
    },
  });
});

/**
 * ADD NEW WHATSAPP NUMBER
 */
export const addWhatsAppNumber = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { phoneNumber, phoneNumberId, accessToken, displayName } = req.body;

  // Validation
  if (!phoneNumber || !phoneNumberId || !accessToken) {
    throw new AppError(
      "Phone number, phone number ID, and access token are required",
      400,
    );
  }

  // Check if phone number already exists globally
  const existingNumber = await prisma.whatsAppNumber.findUnique({
    where: { phoneNumber },
  });

  if (existingNumber) {
    throw new AppError("This phone number is already registered", 409);
  }

  // Check if this organization already has this phone number ID
  const existingPhoneId = await prisma.whatsAppNumber.findFirst({
    where: {
      organizationId: orgId,
      phoneNumberId,
    },
  });

  if (existingPhoneId) {
    throw new AppError(
      "This WhatsApp Phone Number ID is already registered in your organization",
      409,
    );
  }

  const existingPrimary = await prisma.whatsAppNumber.findFirst({
    where: { organizationId: orgId, isPrimary: true },
  });

  // Create WhatsApp number
  const whatsappNumber = await prisma.whatsAppNumber.create({
    data: {
      organizationId: orgId,
      phoneNumber,
      phoneNumberId,
      accessToken,
      displayName: displayName || phoneNumber,
      active: true,
      isPrimary: !existingPrimary,
    },
  });

  logger.info("WhatsApp number added", {
    meta: {
      whatsappNumberId: whatsappNumber.id,
      organizationId: orgId,
      userId,
      phoneNumber: whatsappNumber.phoneNumber,
    },
  });

  // Don't return accessToken
  const { accessToken: _, ...response } = whatsappNumber;

  res.status(201).json({
    status: "success",
    message: "WhatsApp number added successfully",
    data: {
      number: response,
    },
  });
});

/**
 * UPDATE WHATSAPP NUMBER
 */
export const updateWhatsAppNumber = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { numberId } = req.params;
  const { displayName, accessToken } = req.body;

  // Fetch number
  const number = await prisma.whatsAppNumber.findUnique({
    where: { id: numberId },
  });

  if (!number) {
    throw new AppError("WhatsApp number not found", 404);
  }

  if (number.organizationId !== orgId) {
    throw new AppError(
      "This WhatsApp number does not belong to your organization",
      403,
    );
  }

  // Update only allowed fields
  const updateData = {};

  if (displayName !== undefined) {
    updateData.displayName = displayName;
  }

  if (accessToken !== undefined) {
    updateData.accessToken = accessToken;
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError("No fields to update", 400);
  }

  const updated = await prisma.whatsAppNumber.update({
    where: { id: numberId },
    data: updateData,
  });

  logger.info("WhatsApp number updated", {
    meta: {
      whatsappNumberId: numberId,
      organizationId: orgId,
      userId,
      updatedFields: Object.keys(updateData),
    },
  });

  // Don't return accessToken
  const { accessToken: _, ...response } = updated;

  res.status(200).json({
    status: "success",
    message: "WhatsApp number updated successfully",
    data: {
      number: response,
    },
  });
});

/**
 * TOGGLE WHATSAPP NUMBER ACTIVE STATUS
 */
export const toggleWhatsAppNumberStatus = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { numberId } = req.params;

  // Fetch number
  const number = await prisma.whatsAppNumber.findUnique({
    where: { id: numberId },
  });

  if (!number) {
    throw new AppError("WhatsApp number not found", 404);
  }

  if (number.organizationId !== orgId) {
    throw new AppError(
      "This WhatsApp number does not belong to your organization",
      403,
    );
  }

  // Toggle active status
  const updated = await prisma.whatsAppNumber.update({
    where: { id: numberId },
    data: { active: !number.active },
  });

  logger.info("WhatsApp number status toggled", {
    meta: {
      whatsappNumberId: numberId,
      organizationId: orgId,
      userId,
      newStatus: updated.active,
    },
  });

  // Don't return accessToken
  const { accessToken: _, ...response } = updated;

  res.status(200).json({
    status: "success",
    message: `WhatsApp number ${updated.active ? "activated" : "deactivated"}`,
    data: {
      number: response,
    },
  });
});

/**
 * DELETE WHATSAPP NUMBER
 */
export const deleteWhatsAppNumber = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const userId = req.user.id;
  const { numberId } = req.params;

  // Fetch number
  const number = await prisma.whatsAppNumber.findUnique({
    where: { id: numberId },
  });

  if (!number) {
    throw new AppError("WhatsApp number not found", 404);
  }

  if (number.organizationId !== orgId) {
    throw new AppError(
      "This WhatsApp number does not belong to your organization",
      403,
    );
  }

  // Check if number has active messages
  const messageCount = await prisma.message.count({
    where: { whatsappNumberId: numberId },
  });

  if (messageCount > 0) {
    throw new AppError(
      `Cannot delete WhatsApp number with ${messageCount} associated messages. Archive it instead by deactivating it.`,
      400,
    );
  }

  // Delete
  await prisma.whatsAppNumber.delete({
    where: { id: numberId },
  });

  logger.info("WhatsApp number deleted", {
    meta: {
      whatsappNumberId: numberId,
      organizationId: orgId,
      userId,
      phoneNumber: number.phoneNumber,
    },
  });

  res.status(200).json({
    status: "success",
    message: "WhatsApp number deleted successfully",
  });
});

/**
 * GET WHATSAPP NUMBER STATISTICS
 */
export const getWhatsAppNumberStats = catchAsync(async (req, res) => {
  const orgId = req.organization.id;
  const { numberId } = req.params;

  // Fetch number
  const number = await prisma.whatsAppNumber.findUnique({
    where: { id: numberId },
  });

  if (!number) {
    throw new AppError("WhatsApp number not found", 404);
  }

  if (number.organizationId !== orgId) {
    throw new AppError(
      "This WhatsApp number does not belong to your organization",
      403,
    );
  }

  // Get message statistics
  const totalMessages = await prisma.message.count({
    where: { whatsappNumberId: numberId },
  });

  const messagesByDirection = await prisma.message.groupBy({
    by: ["direction"],
    where: { whatsappNumberId: numberId },
    _count: true,
  });

  const messagesByDate = await prisma.message.groupBy({
    by: ["createdAt"],
    where: { whatsappNumberId: numberId },
    _count: true,
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const uniqueContacts = await prisma.message.findMany({
    where: { whatsappNumberId: numberId },
    select: { contactId: true },
    distinct: ["contactId"],
  });

  res.status(200).json({
    status: "success",
    data: {
      number: {
        id: number.id,
        phoneNumber: number.phoneNumber,
        displayName: number.displayName,
        active: number.active,
      },
      statistics: {
        totalMessages,
        uniqueContacts: uniqueContacts.length,
        messagesByDirection: messagesByDirection.map((item) => ({
          direction: item.direction,
          count: item._count,
        })),
        recentActivity: messagesByDate.map((item) => ({
          date: item.createdAt,
          count: item._count,
        })),
      },
    },
  });
});

/**
 * GET PRIMARY WHATSAPP NUMBER
 */
export const getPrimaryWhatsAppNumber = catchAsync(async (req, res) => {
  const orgId = req.organization.id;

  let number = await prisma.whatsAppNumber.findFirst({
    where: {
      organizationId: orgId,
      isPrimary: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!number) {
    number = await prisma.whatsAppNumber.findFirst({
      where: {
        organizationId: orgId,
        active: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!number) {
    return res.status(200).json({
      status: "success",
      data: {
        number: null,
        message: "No active WhatsApp numbers found",
      },
    });
  }

  // Don't return accessToken
  const { accessToken: _, ...numberData } = number;

  res.status(200).json({
    status: "success",
    data: {
      number: numberData,
    },
  });
});
