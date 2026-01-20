import { pool } from "../config/db.js";
import { sendSamples } from "../services/sampleSender.js";
import { notifyRep } from "../services/repNotifier.js";

/**
 * Webhook verification (Meta requirement)
 */
export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

/**
 * Receive incoming WhatsApp messages
 */
export async function receiveMessage(req, res) {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const phone = message.from;
    const text = message.text?.body?.toLowerCase() || "";

    // Fetch contact
    const { rows } = await pool.query("SELECT * FROM contacts WHERE phone=$1", [
      phone,
    ]);

    if (!rows.length) return res.sendStatus(200);

    const contact = rows[0];

    /* ----------------------------------
       HANDLE OPT-OUT / NO
    ---------------------------------- */
    if (
      text.includes("no") ||
      text.includes("not interested") ||
      text.includes("stop")
    ) {
      await pool.query("UPDATE contacts SET status='CLOSED' WHERE phone=$1", [
        phone,
      ]);

      await pool.query(
        "INSERT INTO messages(contact_id, direction, message) VALUES($1,'INBOUND',$2)",
        [contact.id, text],
      );

      return res.sendStatus(200);
    }

    /* ----------------------------------
       HANDLE CONSENT / YES
    ---------------------------------- */
    if (
      text.includes("yes") ||
      text.includes("sure") ||
      text.includes("okay") ||
      text.includes("ok")
    ) {
      if (!contact.consent && contact.status !== "SAMPLES_SENT") {
        // Log inbound
        await pool.query(
          "INSERT INTO messages(contact_id, direction, message) VALUES($1,'INBOUND',$2)",
          [contact.id, text],
        );

        // Update consent
        await pool.query(
          "UPDATE contacts SET consent=true, status='CONSENTED' WHERE phone=$1",
          [phone],
        );

        /* ----------------------------------
           AUTO-ASSIGN SALES REP
        ---------------------------------- */
        const { rows: reps } = await pool.query(
          "SELECT * FROM sales_reps WHERE active=true",
        );

        let assignedRep = null;

        if (reps.length) {
          assignedRep = reps[Math.floor(Math.random() * reps.length)];

          await pool.query("UPDATE contacts SET sales_rep_id=$1 WHERE id=$2", [
            assignedRep.id,
            contact.id,
          ]);
        }

        // Send samples to lead
        await sendSamples(phone);

        await pool.query(
          "INSERT INTO messages(contact_id, direction, message) VALUES($1,'OUTBOUND',$2)",
          [contact.id, "Sent video samples"],
        );

        // Notify sales rep on WhatsApp
        if (assignedRep) {
          await notifyRep(assignedRep.phone, contact.name, contact.phone);

          await pool.query(
            "INSERT INTO messages(contact_id, direction, message) VALUES($1,'OUTBOUND',$2)",
            [contact.id, `Rep notified: ${assignedRep.name}`],
          );
        }

        // Final status
        await pool.query(
          `UPDATE contacts
   SET status='SAMPLES_SENT',
       samples_sent_at = now()
   WHERE phone=$1`,
          [phone],
        );
      }

      return res.sendStatus(200);
    }

    /* ----------------------------------
       HANDLE OTHER MESSAGES
    ---------------------------------- */
    await pool.query(
      "INSERT INTO messages(contact_id, direction, message) VALUES($1,'INBOUND',$2)",
      [contact.id, text],
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.sendStatus(500);
  }
}
