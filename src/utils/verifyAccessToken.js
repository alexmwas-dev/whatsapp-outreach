function assertWhatsAppTokenValid(waNumber) {
  if (!waNumber) {
    throw new AppError(
      "WhatsApp number not configured for this organization",
      400,
    );
  }

  if (!waNumber.accessToken || !waNumber.phoneNumberId) {
    throw new AppError("Invalid WhatsApp number configuration", 400);
  }

  if (
    waNumber.accessTokenExpiresAt &&
    new Date(waNumber.accessTokenExpiresAt) <= new Date()
  ) {
    throw new AppError(
      "WhatsApp access token has expired. Please reconnect WhatsApp.",
      401,
    );
  }
}
export { assertWhatsAppTokenValid };
