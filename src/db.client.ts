import { PrismaClient } from "./generated/prisma";

// Supabase uses PgBouncer internally, which causes "prepared statement already exists" (42P05)
// Fix: append pgbouncer=true to force Prisma to use simple query protocol (no prepared statements)
function buildDatabaseUrl(): string | undefined {
    const url = process.env.DATABASE_URL;
    if (!url) return undefined;
    if (url.includes('pgbouncer=true')) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}pgbouncer=true`;
}

export const prisma = new PrismaClient({
    datasources: {
        db: { url: buildDatabaseUrl() }
    }
});
