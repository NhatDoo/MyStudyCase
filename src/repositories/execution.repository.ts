import { prisma } from "../db.client";
import { ExecutionStatus, Prisma } from "../generated/prisma";

class ExecutionRepository {
    async create(sessionId: string, status: ExecutionStatus) {
        return prisma.execution.create({
            data: {
                sessionId,
                status,
                logs: {
                    create: {
                        status,
                        message: `Execution initialized with status ${status}`
                    }
                }
            },
        });
    }

    async update(executionId: string, data: Prisma.ExecutionUpdateInput & { logMessage?: string }) {
        const { logMessage, ...updateData } = data;
        let logsUpdate = {};

        if (updateData.status) {
            logsUpdate = {
                logs: {
                    create: {
                        status: updateData.status as ExecutionStatus,
                        message: logMessage || `Status transitioned to ${updateData.status}`,
                    }
                }
            };
        }

        return prisma.execution.update({
            where: { id: executionId },
            data: {
                ...updateData,
                ...logsUpdate
            },
        });
    }

    async findById(executionId: string) {
        return prisma.execution.findUnique({
            where: { id: executionId },
            include: { logs: { orderBy: { createdAt: 'desc' } } }
        });
    }

    async findSlowJobs(limit: number = 20) {
   
        return prisma.$queryRaw`
            SELECT id, "sessionId", status, "createdAt", "startedAt",
            EXTRACT(EPOCH FROM ("startedAt" - "createdAt")) * 1000 AS queue_delay_ms
            FROM executions
            WHERE "startedAt" IS NOT NULL
            ORDER BY queue_delay_ms DESC
            LIMIT ${limit}
        `;
    }
}

export const executionRepository = new ExecutionRepository();
