import { prisma } from "../db.client";

export class CodeSessionService {
    async createSession(language: string, sourceCode?: string) {
        const session = await prisma.codeSession.create({
            data: {
                language,
                sourceCode: sourceCode || null,
                status: "ACTIVE",
            },
        });
        return session;
    }

    async updateSession(sessionId: string, sourceCode: string) {
        // Automatically throw if not found
        const session = await prisma.codeSession.update({
            where: { id: sessionId },
            data: { sourceCode },
        });
        return session;
    }
}

export const codeSessionService = new CodeSessionService();
