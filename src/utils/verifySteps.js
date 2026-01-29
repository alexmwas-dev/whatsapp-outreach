function computeWhatsappStatus(steps) {
  const required = [
    "WABA_CONNECTED",
    "WEBHOOK_CONFIGURED",
    "PHONE_NUMBER_VERIFIED",
  ];

  return required.every((step) => steps.includes(step))
    ? "VERIFIED"
    : "PENDING";
}

function isWhatsAppReady(org) {
  return (
    org.whatsappBusinessAccountId &&
    org.messagingTier &&
    org.whatsappStatus === "VERIFIED"
  );
}
export { computeWhatsappStatus, isWhatsAppReady };
