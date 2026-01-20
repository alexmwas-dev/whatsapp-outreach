// Campaign controller placeholder
import { pool } from "../config/db.js";
import { sendIntroTemplate } from "../services/whatsappService.js";
import { sleep } from "../utils/sleep.js";

export async function sendCampaign(req, res) {
  const { agencyName } = req.body;

  const { rows: contacts } = await pool.query(
    "SELECT * FROM contacts WHERE status = 'NEW' LIMIT 20",
  );

  for (const contact of contacts) {
    await sendIntroTemplate(contact.phone, contact.name, agencyName);

    await pool.query(
      "UPDATE contacts SET status='INTRO_SENT', last_message_at=now() WHERE id=$1",
      [contact.id],
    );

    await sleep(60000); // 1 min delay
  }

  res.json({ sent: contacts.length });
}
