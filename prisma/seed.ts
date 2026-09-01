import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.upsert({
    where: { id: "seed-client" },
    update: {},
    create: {
      id: "seed-client",
      name: "Example Local Business",
      notes: "Seed data for the first Star Reports workspace."
    }
  });

  const project = await prisma.project.upsert({
    where: { id: "seed-project" },
    update: {},
    create: {
      id: "seed-project",
      clientId: client.id,
      name: "Local SEO Tracking",
      domain: "example.co.uk",
      targetBusinessName: "Example Local Business",
      serviceArea: "Manchester"
    }
  });

  await prisma.keyword.createMany({
    data: [
      { projectId: project.id, phrase: "emergency plumber manchester", group: "Emergency" },
      { projectId: project.id, phrase: "boiler repair manchester", group: "Repairs" },
      { projectId: project.id, phrase: "local plumber near me", group: "Near me" }
    ],
    skipDuplicates: true
  });

  await prisma.location.createMany({
    data: [
      {
        projectId: project.id,
        name: "Manchester",
        countryCode: "GB",
        dataForSeoLocationName: "Manchester,England,United Kingdom"
      },
      {
        projectId: project.id,
        name: "Stockport",
        countryCode: "GB",
        dataForSeoLocationName: "Stockport,England,United Kingdom"
      }
    ],
    skipDuplicates: true
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
