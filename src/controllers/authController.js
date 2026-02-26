import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
// import { prisma } from "../lib/prisma.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/AppError.js";
import logger from "../utils/loogger.js";
import { prisma } from "../lib/prisma.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_EXPIRE = process.env.JWT_EXPIRE || "7d";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

/**
 * Generate JWT Token
 */
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

const buildOrganizationSlugBase = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const generateUniqueOrganizationSlug = async (name) => {
  const slugBase = buildOrganizationSlugBase(name);
  let slug = slugBase || `org-${Math.random().toString(36).slice(2, 8)}`;

  const exists = await prisma.organization.findUnique({ where: { slug } });
  if (exists) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  return slug;
};

const createOwnerAccountWithOrganization = async ({
  name,
  email,
  password = null,
  googleId = null,
}) => {
  const slug = await generateUniqueOrganizationSlug(name);

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: `${name}'s Org`,
        slug,
        plan: "FREE",
      },
    });

    const user = await tx.user.create({
      data: {
        name,
        email,
        password,
        googleId,
        role: "OWNER",
        organizationId: organization.id,
      },
    });

    await tx.subscription.create({
      data: {
        organizationId: organization.id,
        status: "TRIAL",
        plan: "FREE",
        messageLimit: 100,
        messagesUsed: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        provider: "trial",
      },
    });

    return { user, organization };
  });
};

const buildAuthResponseData = (user, organization = user.organization) => {
  if (!organization) {
    throw new AppError("User account is not linked to an organization", 400);
  }

  return {
    token: generateToken(user.id),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
    },
  };
};

const verifyGoogleCredential = async (credential) => {
  if (!GOOGLE_CLIENT_ID) {
    throw new AppError("Google sign-in is not configured", 500);
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
      credential,
    )}`,
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.warn("Google token verification failed", {
      meta: { response: payload },
    });
    throw new AppError("Invalid Google credential", 401);
  }

  if (payload.aud !== GOOGLE_CLIENT_ID) {
    throw new AppError("Google credential audience mismatch", 401);
  }

  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new AppError("Invalid Google token issuer", 401);
  }

  if (!(payload.email_verified === "true" || payload.email_verified === true)) {
    throw new AppError("Google email is not verified", 401);
  }

  if (!payload.sub || !payload.email) {
    throw new AppError("Google credential is missing required fields", 401);
  }

  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && exp * 1000 <= Date.now()) {
    throw new AppError("Google credential has expired", 401);
  }

  return payload;
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

  const { user, organization } = await createOwnerAccountWithOrganization({
    name,
    email,
    password: hashedPassword,
  });

  logger.info("User signup completed", { meta: { userId: user.id } });

  res.status(201).json({
    status: "success",
    data: buildAuthResponseData(user, organization),
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

  if (!user.password) {
    throw new AppError(
      "This account uses Google sign-in. Continue with Google",
      400,
    );
  }

  // Verify password
  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  logger.info("User login successful", {
    meta: { userId: user.id },
  });

  res.status(200).json({
    status: "success",
    data: buildAuthResponseData(user),
  });
});

/**
 * GOOGLE AUTH - Login or Signup with Google ID token
 */
export const googleAuth = catchAsync(async (req, res) => {
  const { credential } = req.body;

  if (!credential || typeof credential !== "string") {
    throw new AppError("Google credential is required", 400);
  }

  const googlePayload = await verifyGoogleCredential(credential);
  const googleId = googlePayload.sub;
  const email = String(googlePayload.email).trim().toLowerCase();
  const name =
    String(googlePayload.name || "").trim() || email.split("@")[0] || "User";

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ googleId }, { email }],
    },
    include: {
      organization: true,
    },
  });

  if (!user) {
    const created = await createOwnerAccountWithOrganization({
      name,
      email,
      googleId,
    });

    logger.info("User Google signup completed", {
      meta: { userId: created.user.id },
    });

    return res.status(200).json({
      status: "success",
      data: buildAuthResponseData(created.user, created.organization),
    });
  }

  if (user.googleId && user.googleId !== googleId) {
    throw new AppError(
      "This email is linked to a different Google account",
      409,
    );
  }

  if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId },
      include: {
        organization: true,
      },
    });
  }

  logger.info("User Google login successful", {
    meta: { userId: user.id },
  });

  res.status(200).json({
    status: "success",
    data: buildAuthResponseData(user),
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

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (!user.password) {
    throw new AppError(
      "Password login is not enabled for this account. Use Google sign-in",
      400,
    );
  }

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
