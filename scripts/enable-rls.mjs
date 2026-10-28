import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tables = [
  "User",
  "UserSettings",
  "Subject",
  "Chapter",
  "Document",
  "DocumentChunk",
  "DocumentAnalysis",
  "Exercise",
  "Session",
  "SessionItem",
  "Answer",
  "ConceptStat",
  "StudyRecommendation",
  "ProgramRun",
  "SqlQueryLog",
  "ChatMessage",
  "AIUsageLog",
];

async function main() {
  console.log("Activating Row Level Security (RLS) on all public tables...");
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`✓ RLS enabled for public."${table}"`);
    } catch (e) {
      console.error(`✗ Error on table "${table}":`, e.message);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
