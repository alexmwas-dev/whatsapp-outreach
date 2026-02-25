import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInviteEmail({ to, name, orgName, tempPassword }) {
  return resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: `You're invited to join ${orgName}`,
    html: `
      <div style="
        font-family: Arial, Helvetica, sans-serif;
        background-color: #f9fafb;
        padding: 40px 20px;
      ">
        <div style="
          max-width: 520px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 10px;
          padding: 32px;
          box-shadow: 0 10px 20px rgba(0,0,0,0.08);
        ">
          <h2 style="margin-top: 0; color: #111827;">
            Welcome, ${name} 👋
          </h2>

          <p style="color: #374151; font-size: 15px; line-height: 1.6;">
            You’ve been invited to join <strong>${orgName}</strong>.
            Your account has been created and you can log in using the
            temporary credentials below.
          </p>

          <div style="
            background: #f3f4f6;
            border-radius: 8px;
            padding: 16px;
            margin: 24px 0;
          ">
            <p style="
              margin: 0 0 8px;
              font-size: 13px;
              color: #6b7280;
            ">
              Temporary password
            </p>

            <div style="
              font-size: 18px;
              font-weight: bold;
              letter-spacing: 1px;
              color: #111827;
            ">
              ${tempPassword}
            </div>
          </div>

          <p style="color: #374151; font-size: 14px; line-height: 1.6;">
            For security reasons, please log in and change your password
            immediately.
          </p>

          <p style="
            margin-top: 32px;
            font-size: 14px;
            color: #374151;
          ">
            — <strong>${orgName} Team</strong>
          </p>

          <hr style="
            margin: 32px 0;
            border: none;
            border-top: 1px solid #e5e7eb;
          " />

          <p style="
            font-size: 12px;
            color: #9ca3af;
            text-align: center;
          ">
            If you weren’t expecting this invitation, you can safely ignore
            this email.
          </p>
        </div>
      </div>
    `,
  });
}

export async function sendLeadAssignedEmail({
  to,
  repName,
  leadName,
  leadPhone,
  orgName,
}) {
  return resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: `New lead assigned: ${leadName}`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f9fafb; padding: 24px 16px;">
        <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 10px; padding: 24px; box-shadow: 0 8px 16px rgba(0,0,0,0.06);">
          <h2 style="margin-top: 0; color: #111827;">New Lead Assigned</h2>
          <p style="color: #374151; font-size: 14px; line-height: 1.6;">
            Hi ${repName || "Sales Rep"}, a new lead has been assigned to you${orgName ? ` from <strong>${orgName}</strong>` : ""}.
          </p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 14px; margin: 16px 0;">
            <p style="margin: 0 0 6px; color: #6b7280; font-size: 12px;">Lead Name</p>
            <p style="margin: 0 0 12px; font-weight: 600; color: #111827;">${leadName || "Unknown"}</p>
            <p style="margin: 0 0 6px; color: #6b7280; font-size: 12px;">Lead Phone</p>
            <p style="margin: 0; font-weight: 600; color: #111827;">${leadPhone || "Unknown"}</p>
          </div>
          <p style="color: #374151; font-size: 13px; line-height: 1.6;">
            Follow up with this lead as soon as possible.
          </p>
        </div>
      </div>
    `,
  });
}
