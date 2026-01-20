// Script to import contacts placeholder
import dotenv from "dotenv";
dotenv.config();

import { importCSV } from "../src/services/csvImportService.js";

importCSV("data/contacts.csv");

console.log("Contacts imported");
