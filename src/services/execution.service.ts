import { prisma } from "../db.client";
import { executionQueue } from "../queues/execution.queue";
import { executionRepository } from "../repositories/execution.repository";

class ExecutionService {
    async createExecution(sessionId: string) {
        // 1. Verify if the session exists
        const session = await prisma.codeSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            throw new Error("SESSION_NOT_FOUND");
        }

        // 2. Create the execution record
        const execution = await prisma.execution.create({
            data: {
                sessionId: session.id,
                status: "QUEUED",
            },
        });

        // 3. Push the execution to the queue
        await executionQueue.pushExecutionJob(
            execution.id,
            session.id,
            session.language,
            session.sourceCode || ""
        );

        return execution;
    }

    async getExecution(executionId: string) {
        const execution = await executionRepository.findById(executionId);
        if (!execution) {
            throw new Error("EXECUTION_NOT_FOUND");
        }
        return execution;
    }

    async getSlowJobs() {
        return executionRepository.findSlowJobs();
    }
}

export const executionService = new ExecutionService();
