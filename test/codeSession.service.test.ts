import { CodeSessionService } from '../src/services/codeSession.service';
import { ICodeSessionRepository } from '../src/repositories/codeSession.repository';
import { CodeSession } from '../src/generated/prisma';

describe('CodeSessionService', () => {
    let mockRepo: jest.Mocked<ICodeSessionRepository>;
    let service: CodeSessionService;

    beforeEach(() => {
        // Create a mock implementation of the repository
        mockRepo = {
            create: jest.fn(),
            findById: jest.fn(),
            update: jest.fn()
        };

        // Inject the mock repo into our service
        service = new CodeSessionService(mockRepo);
    });

    describe('createSession', () => {
        it('should call repository create with ACTIVE status', async () => {
            const mockSession: CodeSession = {
                id: '123',
                language: 'python',
                sourceCode: 'print(1)',
                status: 'ACTIVE',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            mockRepo.create.mockResolvedValue(mockSession);

            const result = await service.createSession('python', 'print(1)');

            expect(mockRepo.create).toHaveBeenCalledWith({
                language: 'python',
                sourceCode: 'print(1)',
                status: 'ACTIVE'
            });
            expect(result).toEqual(mockSession);
        });
    });

    describe('updateSession', () => {
        it('should throw SESSION_NOT_FOUND if session does not exist', async () => {
            mockRepo.update.mockRejectedValue(new Error('SESSION_NOT_FOUND'));

            await expect(service.updateSession('123', 'new code'))
                .rejects
                .toThrow('SESSION_NOT_FOUND');

            expect(mockRepo.update).toHaveBeenCalledWith('123', { sourceCode: 'new code' });
        });

        it('should update session if it exists', async () => {
            const mockSession: CodeSession = {
                id: '123',
                language: 'python',
                sourceCode: 'old code',
                status: 'ACTIVE',
                createdAt: new Date(),
                updatedAt: new Date()
            };

            mockRepo.update.mockResolvedValue({ ...mockSession, sourceCode: 'new code' });

            const result = await service.updateSession('123', 'new code');

            expect(mockRepo.update).toHaveBeenCalledWith('123', { sourceCode: 'new code' });
            expect(result.sourceCode).toBe('new code');
        });
    });
});
