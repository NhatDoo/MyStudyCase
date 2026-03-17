import { prisma } from "../db.client";
import { Prisma, CodeSession } from "../generated/prisma";

export interface ICodeSessionRepository {
    create(data: Prisma.CodeSessionCreateInput): Promise<CodeSession>;
    findById(id: string): Promise<CodeSession | null>;
    update(id: string, data: Prisma.CodeSessionUpdateInput): Promise<CodeSession>;
}

export class CodeSessionRepository implements ICodeSessionRepository {
    async create(data: Prisma.CodeSessionCreateInput): Promise<CodeSession> {
        return prisma.codeSession.create({ data });
    }

    async findById(id: string): Promise<CodeSession | null> {
        return prisma.codeSession.findUnique({ where: { id } });
    }

    async update(id: string, data: Prisma.CodeSessionUpdateInput): Promise<CodeSession> {
        try {
            return await prisma.codeSession.update({
                where: { id },
                data,
            });
        } catch (error: any) {
            if (error.code === 'P2025') {
                throw new Error("SESSION_NOT_FOUND");
            }
            throw error;
        }
    }
}

// Single instance for Dependency Injection root
export const codeSessionRepository = new CodeSessionRepository();
