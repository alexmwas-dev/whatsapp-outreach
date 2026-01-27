import { prisma } from "./prisma.js";

async function main() {
  try {
    // Create a new contact
    const newContact = await prisma.contact.create({
      data: {
        name: "Collins Otieno",
        phone: "254705666724", // must be unique
        email: "collinsOtieno@gmail.com",
      },
    });
    // const salesRep = await prisma.salesRep.create({
    //   data: {
    //     name: "Sandra Kome",
    //     phone: "254739843854",
    //     email: "sandrakome@gmail.com",
    //     active: true,
    //   },
    // });

    console.log("New contact created:", newContact);
    console.log("New sales rep created:", salesRep);

    // Optional: fetch all contacts to verify
    const contacts = await prisma.contact.findMany();
    console.log("All contacts:", contacts);
  } catch (error) {
    console.error("Error creating contact:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
