import cron from "node-cron";
import { pool } from "../config/db.js";
import { sendFollowUpTemplate } from "../services/followUpSender.js";

cron.schedule("0 * * * *", async () => {
  console.log("Running follow-up job...");

  const { rows: contacts } = await pool.query(`
    SELECT *
    FROM contacts
    WHERE status='SAMPLES_SENT'
    AND samples_sent_at < now() - interval '48 hours'
  `);

  for (const contact of contacts) {
    await sendFollowUpTemplate(contact.phone, contact.name);

    await pool.query(
      "INSERT INTO messages(contact_id, direction, message) VALUES($1,'OUTBOUND',$2)",
      [contact.id, "Sent 48h follow-up template"],
    );

    // Optional: prevent repeat follow-ups
    await pool.query("UPDATE contacts SET status='FOLLOWED_UP' WHERE id=$1", [
      contact.id,
    ]);
  }
});
