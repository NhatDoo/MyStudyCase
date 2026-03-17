import { ICodeSessionRepository, codeSessionRepository } from "../repositories/codeSession.repository";

export class CodeSessionService {
    constructor(private readonly codeSessionRepo: ICodeSessionRepository) { }

    async createSession(language: string, sourceCode?: string) {
        const session = await this.codeSessionRepo.create({
            language,
            sourceCode: sourceCode || null,
            status: "ACTIVE",
        });
        return session;
    }

    async updateSession(sessionId: string, sourceCode: string) {
        const session = await this.codeSessionRepo.update(sessionId, { sourceCode });
        return session;
    }
}

// Instantiate with dependency injection
export const codeSessionService = new CodeSessionService(codeSessionRepository);
