import { IExecutionQueue, executionQueue } from "../queues/execution.queue";
import { IExecutionRepository, executionRepository } from "../repositories/execution.repository";
import { ICodeSessionRepository, codeSessionRepository } from "../repositories/codeSession.repository";
import { ExecutionStatus } from "../generated/prisma";

export class ExecutionService {
    constructor(
        private readonly executionRepo: IExecutionRepository,
        private readonly sessionRepo: ICodeSessionRepository,
        private readonly executionQueueInst: IExecutionQueue
    ) { }

    async createExecution(sessionId: string) {
        // 1. Verify if the session exists
        const session = await this.sessionRepo.findById(sessionId);

        if (!session) {
            throw new Error("SESSION_NOT_FOUND");
        }

        // 2. Create the execution record
        const execution = await this.executionRepo.create(session.id, ExecutionStatus.QUEUED);

        // 3. Push the execution to the queue
        try {
            await this.executionQueueInst.pushExecutionJob(
                execution.id,
                session.id,
                session.language,
                session.sourceCode || ""
            );
        } catch (error) {
            await this.executionRepo.update(execution.id, {
                status: ExecutionStatus.FAILED,
                logMessage: "Failed to enqueue job due to message broker error"
            });
            throw new Error("FAILED_TO_QUEUE");
        }

        return execution;
    }

    async getExecution(executionId: string) {
        const execution = await this.executionRepo.findById(executionId);
        if (!execution) {
            throw new Error("EXECUTION_NOT_FOUND");
        }
        return execution;
    }

    async getSlowJobs() {
        return this.executionRepo.findSlowJobs();
    }
}

export const executionService = new ExecutionService(executionRepository, codeSessionRepository, executionQueue);
