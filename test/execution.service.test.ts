import { ExecutionService } from '../src/services/execution.service';
import { IExecutionRepository } from '../src/repositories/execution.repository';
import { ICodeSessionRepository } from '../src/repositories/codeSession.repository';
import { IExecutionQueue } from '../src/queues/execution.queue';
import { ExecutionStatus, Execution, CodeSession } from '../src/generated/prisma';

describe('ExecutionService', () => {
    let mockExecutionRepo: jest.Mocked<IExecutionRepository>;
    let mockSessionRepo: jest.Mocked<ICodeSessionRepository>;
    let mockQueue: jest.Mocked<IExecutionQueue>;
    let service: ExecutionService;

    beforeEach(() => {
        mockExecutionRepo = {
            create: jest.fn(),
            update: jest.fn(),
            findById: jest.fn(),
            findSlowJobs: jest.fn()
        };

        mockSessionRepo = {
            create: jest.fn(),
            findById: jest.fn(),
            update: jest.fn()
        };

        mockQueue = {
            connect: jest.fn(),
            pushExecutionJob: jest.fn()
        };

        service = new ExecutionService(mockExecutionRepo, mockSessionRepo, mockQueue);
    });

    describe('createExecution', () => {
        it('should throw SESSION_NOT_FOUND if session not found', async () => {
            mockSessionRepo.findById.mockResolvedValue(null);

            await expect(service.createExecution('unknown-session-id'))
                .rejects
                .toThrow('SESSION_NOT_FOUND');
        });

        it('should create execution and push it into the queue', async () => {
            const mockSession: CodeSession = {
                id: 'session-123',
                language: 'javascript',
                sourceCode: 'console.log("hello")',
                status: 'ACTIVE',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const mockExecution: Execution = {
                id: 'exec-123',
                sessionId: 'session-123',
                status: ExecutionStatus.QUEUED,
                stdout: null,
                stderr: null,
                executionTimeMs: null,
                createdAt: new Date(),
                startedAt: null,
                completedAt: null
            };

            mockSessionRepo.findById.mockResolvedValue(mockSession);
            mockExecutionRepo.create.mockResolvedValue(mockExecution);
            mockQueue.pushExecutionJob.mockResolvedValue();

            const result = await service.createExecution('session-123');

            expect(mockSessionRepo.findById).toHaveBeenCalledWith('session-123');
            expect(mockExecutionRepo.create).toHaveBeenCalledWith('session-123', ExecutionStatus.QUEUED);
            expect(mockQueue.pushExecutionJob).toHaveBeenCalledWith(
                'exec-123',
                'session-123',
                'javascript',
                'console.log("hello")'
            );
            expect(result.status).toBe(ExecutionStatus.QUEUED);
        });

        it('should rollback execution status to FAILED if queue push fails', async () => {
            const mockSession: any = {
                id: 'session-123',
                language: 'javascript'
            };

            const mockExecution: any = {
                id: 'exec-123',
                sessionId: 'session-123',
                status: ExecutionStatus.QUEUED
            };

            mockSessionRepo.findById.mockResolvedValue(mockSession);
            mockExecutionRepo.create.mockResolvedValue(mockExecution);

            // Inject MQ crash
            mockQueue.pushExecutionJob.mockRejectedValue(new Error('MQ down!'));

            await expect(service.createExecution('session-123'))
                .rejects
                .toThrow('FAILED_TO_QUEUE');

            // Verify rollback update
            expect(mockExecutionRepo.update).toHaveBeenCalledWith('exec-123', {
                status: ExecutionStatus.FAILED,
                logMessage: "Failed to enqueue job due to message broker error"
            });
        });
    });

    describe('getExecution', () => {
        it('should throw EXECUTION_NOT_FOUND if invalid executionId', async () => {
            mockExecutionRepo.findById.mockResolvedValue(null);

            await expect(service.getExecution('invalid-id'))
                .rejects
                .toThrow('EXECUTION_NOT_FOUND');
        });
    });
});
