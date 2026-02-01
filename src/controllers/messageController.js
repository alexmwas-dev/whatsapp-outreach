import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import { prisma } from "../lib/prisma.js";
import { sendTextMessage } from "../services/whatsappService.js";
import { ensurePlus } from "../utils/ensurePlus.js";
// import { whatsappService } from "../services/whatsappService.js"

/**
 * GET MESSAGES FOR A CONTACT
 * Sales rep can view all messages with their assigned contact
 */
export const getContactMessages = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { contactId } = req.params;

  // Get sales rep associated with user
  const salesRep = await prisma.salesRep.findUnique({
    where: { userId },
  });

  if (!salesRep) {
    throw new AppError("Sales rep profile not found", 404);
  }

  // Verify contact is assigned to this sales rep
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      salesRepId: salesRep.id,
      organizationId: salesRep.organizationId,
    },
  });

  if (!contact) {
    throw new AppError("Contact not found or not assigned to you", 404);
  }

  // Get all messages for this contact
  const messages = await prisma.message.findMany({
    where: {
      contactId,
      organizationId: salesRep.organizationId,
    },
    include: {
      salesRep: {
        select: {
          id: true,
          name: true,
        },
      },
      whatsappNumber: {
        select: {
          phoneNumber: true,
          displayName: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // Mark unread messages as read
  // Mark unread inbound messages as read (only for this sales rep)
  await prisma.message.updateMany({
    where: {
      contactId,
      salesRepId: salesRep.id,
      direction: "INBOUND",
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        status: contact.status,
      },
      messages,
    },
  });
});

/**
 * SEND MESSAGE TO CONTACT
 * Sales rep sends a message to their assigned contact
 */
export const sendMessageToContact = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { contactId } = req.params;
  const { message } = req.body;

  if (!message || !message.trim()) {
    throw new AppError("Message is required", 400);
  }

  // Get sales rep associated with user
  const salesRep = await prisma.salesRep.findUnique({
    where: { userId },
    include: {
      organization: true,
    },
  });

  if (!salesRep) {
    throw new AppError("Sales rep profile not found", 404);
  }

  // Verify contact is assigned to this sales rep
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      salesRepId: salesRep.id,
      organizationId: salesRep.organizationId,
    },
  });

  if (!contact) {
    throw new AppError("Contact not found or not assigned to you", 404);
  }

  // Check consent
  if (!contact.consent) {
    throw new AppError("Contact has not consented to receive messages", 403);
  }

  // Get active WhatsApp number
  const whatsappNumber = await prisma.whatsAppNumber.findFirst({
    where: {
      organizationId: salesRep.organizationId,
      active: true,
    },
  });

  if (!whatsappNumber) {
    throw new AppError("No active WhatsApp number configured", 400);
  }

  try {
    const phoneWithPlus = ensurePlus(contact.phone);

    // ✅ FIXED: correct function call
    await sendTextMessage({
      phone: phoneWithPlus,
      text: message.trim(),
      waNumber: whatsappNumber,
    });

    const savedMessage = await prisma.message.create({
      data: {
        organizationId: salesRep.organizationId,
        contactId: contact.id,
        salesRepId: salesRep.id,
        whatsappNumberId: whatsappNumber.id,
        direction: "OUTBOUND",
        message: message.trim(),
      },
      include: {
        salesRep: {
          select: { id: true, name: true },
        },
        whatsappNumber: {
          select: { phoneNumber: true, displayName: true },
        },
      },
    });

    logger.info("Message sent to contact", {
      meta: {
        contactId,
        salesRepId: salesRep.id,
        messageId: savedMessage.id,
      },
    });

    res.status(201).json({
      status: "success",
      data: { message: savedMessage },
    });
  } catch (error) {
    logger.error("Failed to send message to contact", {
      meta: {
        contactId,
        salesRepId: salesRep.id,
        error: error.message,
      },
    });

    throw new AppError("Failed to send message: " + error.message, 500);
  }
});
/**
 * GET ALL ASSIGNED CONTACTS
 * Sales rep can view all contacts assigned to them
 */
export const getAssignedContacts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;

  // Get sales rep associated with user
  const salesRep = await prisma.salesRep.findUnique({
    where: { userId },
  });

  if (!salesRep) {
    throw new AppError("Sales rep profile not found", 404);
  }

  // Build filter
  const filter = {
    salesRepId: salesRep.id,
    organizationId: salesRep.organizationId,
  };

  if (status) {
    filter.status = status;
  }

  // Get contacts with unread message count
  const contacts = await prisma.contact.findMany({
    where: filter,
    include: {
      messages: {
        where: {
          direction: "INBOUND",
          readAt: null,
        },
        select: {
          id: true,
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  // Format response with unread count
  const formattedContacts = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    status: contact.status,
    consent: contact.consent,
    converted: contact.converted,
    unreadCount: contact.messages.length,
    totalMessages: contact._count.messages,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  }));

  res.status(200).json({
    status: "success",
    data: {
      contacts: formattedContacts,
    },
  });
});

/**
 * GET UNREAD MESSAGE COUNT
 * Get total number of unread messages for sales rep
 */
export const getUnreadCount = catchAsync(async (req, res) => {
  const userId = req.user.id;

  // Get sales rep associated with user
  const salesRep = await prisma.salesRep.findUnique({
    where: { userId },
  });

  if (!salesRep) {
    throw new AppError("Sales rep profile not found", 404);
  }

  // Count unread messages across all assigned contacts
  const unreadCount = await prisma.message.count({
    where: {
      salesRepId: salesRep.id,
      direction: "INBOUND",
      readAt: null,
    },
  });

  res.status(200).json({
    status: "success",
    data: {
      unreadCount,
    },
  });
});
