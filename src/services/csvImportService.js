// CSV import service placeholder
import fs from "fs";
import csv from "csv-parser";
import { pool } from "../config/db.js";

export async function importCSV(path) {
  const contacts = [];

  fs.createReadStream(path)
    .pipe(csv())
    .on("data", (row) => contacts.push(row))
    .on("end", async () => {
      for (const c of contacts) {
        await pool.query(
          "INSERT INTO contacts(name, phone) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [c.name, c.phone],
        );
      }
      console.log("Contacts imported");
      process.exit();
    });
}
