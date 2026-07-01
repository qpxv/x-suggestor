import { defineConfig } from "prisma/config";
import { config } from "dotenv";

config(); // load .env before Prisma reads process.env

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
});
