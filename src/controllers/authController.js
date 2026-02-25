import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
// import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import { prisma } from "../lib/prisma.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_EXPIRE = process.env.JWT_EXPIRE || "7d";

/**
 * Generate JWT Token
 */
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

/**
 * SIGNUP - Create new user
 */
export const signup = catchAsync(async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    throw new AppError("Email, password, and name are required", 400);
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters long", 400);
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError("Email already in use", 409);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: "ADMIN", // default role, can upgrade later
    },
  });
  // Create an organization for the user and assign OWNER role
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  // Ensure unique slug by appending short suffix if needed
  let slug = slugBase || `org-${Math.random().toString(36).slice(2, 8)}`;
  const exists = await prisma.organization.findUnique({ where: { slug } });
  if (exists) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `${name}'s Org`,
        slug,
        plan: "FREE",
      },
    });

    // Link user to org and set role OWNER
    await tx.user.update({
      where: { id: user.id },
      data: { role: "OWNER", organizationId: org.id },
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

  const token = generateToken(user.id);

  logger.info("User signup completed", { meta: { userId: user.id } });

  res.status(201).json({
    status: "success",
    data: {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: "OWNER",
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
    },
  });
});

/**
 * LOGIN - Authenticate user
 */
export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    throw new AppError("Email and password are required", 400);
  }

  // Find user with organization
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      organization: true,
    },
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  // Verify password
  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  // Generate token
  const token = generateToken(user.id);

  logger.info("User login successful", {
    meta: { userId: user.id },
  });

  res.status(200).json({
    status: "success",
    data: {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        plan: user.organization.plan,
      },
    },
  });
});

/**
 * GET CURRENT USER
 */
export const getCurrentUser = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: {
        include: {
          subscription: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  res.status(200).json({
    status: "success",
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        plan: user.organization.plan,
      },
      subscription: user.organization.subscription || null,
    },
  });
});

/**
 * UPDATE PROFILE
 */
export const updateProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { name, email } = req.body;

  // Check if new email is already taken
  if (email) {
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        NOT: { id: userId },
      },
    });

    if (existingUser) {
      throw new AppError("Email already in use", 409);
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name && { name }),
      ...(email && { email }),
    },
    include: {
      organization: true,
    },
  });

  logger.info("User profile updated", {
    meta: { userId },
  });

  res.status(200).json({
    status: "success",
    data: {
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    },
  });
});

/**
 * CHANGE PASSWORD
 */
export const changePassword = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new AppError("All fields are required", 400);
  }

  if (newPassword !== confirmPassword) {
    throw new AppError("New passwords do not match", 400);
  }

  if (newPassword.length < 8) {
    throw new AppError("Password must be at least 8 characters long", 400);
  }

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  // Verify current password
  const passwordMatch = await bcrypt.compare(currentPassword, user.password);

  if (!passwordMatch) {
    throw new AppError("Current password is incorrect", 401);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  logger.info("User password changed", {
    meta: { userId },
  });

  res.status(200).json({
    status: "success",
    message: "Password changed successfully",
  });
});

/**
 * LOGOUT (client-side token deletion)
 */
export const logout = catchAsync(async (req, res) => {
  logger.info("User logout", {
    meta: { userId: req.user.id },
  });

  res.status(200).json({
    status: "success",
    message: "Logged out successfully",
  });
});
