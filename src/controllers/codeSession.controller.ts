import { Request, Response } from "express";
import { CodeSessionService } from "../services/codeSession.service";
import { ExecutionService } from "../services/execution.service";
import { logger } from "../utils/logger";

export class CodeSessionController {
    constructor(
        private readonly codeSessionService: CodeSessionService,
        private readonly executionService: ExecutionService
    ) { }

    /**
     * @swagger
     * /code-sessions:
     *   post:
     *     summary: Create a new Code Session
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - language
     *             properties:
     *               language:
     *                 type: string
     *                 example: "python"
     *               sourceCode:
     *                 type: string
     *                 example: "print('Hello World')"
     *     responses:
     *       201:
     *         description: Code Session created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 session_id:
     *                   type: string
     *                   example: "f47ac10b-58cc-4372-a567-0e02b2c3d479"
     *                 status:
     *                   type: string
     *                   example: "ACTIVE"
     *       400:
     *         description: Invalid or missing language
     *       500:
     *         description: Internal server error
     */
    async createSession(req: Request, res: Response): Promise<void> {
        try {
            const { language, sourceCode } = req.body;

            // Validate language against whitelist
            const SUPPORTED_LANGUAGES = ['python', 'javascript', 'nodejs'];
            if (!language || typeof language !== "string" || !SUPPORTED_LANGUAGES.includes(language)) {
                res.status(400).json({ error: `Language not supported. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` });
                return;
            }

            // Validate sourceCode size (max 50KB)
            const MAX_CODE_SIZE = 50_000;
            if (sourceCode && typeof sourceCode === "string" && sourceCode.length > MAX_CODE_SIZE) {
                res.status(400).json({ error: "Source code exceeds maximum size limit (50KB)" });
                return;
            }

            const session = await this.codeSessionService.createSession(language, sourceCode);

            res.status(201).json({
                session_id: session.id,
                status: session.status,
            });
        } catch (error: any) {
            logger.error({ err: error, body: req.body }, "Error creating code session");
            res.status(500).json({ error: "Internal server error" });
        }
    }

    /**
     * @swagger
     * /code-sessions/{session_id}:
     *   patch:
     *     summary: Autosave code session source code
     *     parameters:
     *       - in: path
     *         name: session_id
     *         required: true
     *         schema:
     *           type: string
     *           format: uuid
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - sourceCode
     *             properties:
     *               sourceCode:
     *                 type: string
     *                 example: "new code content"
     *     responses:
     *       200:
     *         description: Updated successfully
     *       400:
     *         description: Bad request
     *       404:
     *         description: Session not found
     */
    async updateSession(req: Request, res: Response): Promise<void> {
        try {
            const { session_id } = req.params;
            const { sourceCode } = req.body;

            if (typeof sourceCode !== "string") {
                res.status(400).json({ error: "Invalid sourceCode" });
                return;
            }

            // Validate sourceCode size (max 50KB)
            const MAX_CODE_SIZE = 50_000;
            if (sourceCode.length > MAX_CODE_SIZE) {
                res.status(400).json({ error: "Source code exceeds maximum size limit (50KB)" });
                return;
            }

            try {
                await this.codeSessionService.updateSession(session_id as string, sourceCode);
                res.status(200).json({ message: "Updated successfully" });
            } catch (err: any) {
                if (err.message === "SESSION_NOT_FOUND") {
                    res.status(404).json({ error: "Session not found" });
                } else {
                    throw err;
                }
            }
        } catch (error: any) {
            logger.error({ err: error, session_id: req.params.session_id }, "Error updating session");
            res.status(500).json({ error: "Internal server error" });
        }
    }

    /**
     * @swagger
     * /code-sessions/{session_id}/run:
     *   post:
     *     summary: Run code session (Async)
     *     parameters:
     *       - in: path
     *         name: session_id
     *         required: true
     *         schema:
     *           type: string
     *           format: uuid
     *     responses:
     *       200:
     *         description: Execution queued
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 execution_id:
     *                   type: string
     *                 status:
     *                   type: string
     *                   example: "QUEUED"
     *       404:
     *         description: Session not found
     *       500:
     *         description: Internal server error
     */
    async runSession(req: Request, res: Response): Promise<void> {
        try {
            const { session_id } = req.params;
            const execution = await this.executionService.createExecution(session_id as string);

            res.status(200).json({
                execution_id: execution.id,
                status: execution.status,
            });
        } catch (error: any) {
            if (error.message === "SESSION_NOT_FOUND") {
                res.status(404).json({ error: "Session not found" });
            } else {
                logger.error({ err: error, session_id: req.params.session_id }, "Error creating execution");
                res.status(500).json({ error: "Internal server error" });
            }
        }
    }

    /**
     * @swagger
     * /executions/{execution_id}:
     *   get:
     *     summary: Get execution result
     *     parameters:
     *       - in: path
     *         name: execution_id
     *         required: true
     *         schema:
     *           type: string
     *           format: uuid
     *     responses:
     *       200:
     *         description: Execution result
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 execution_id:
     *                   type: string
     *                 status:
     *                   type: string
     *                 stdout:
     *                   type: string
     *                 stderr:
     *                   type: string
     *                 execution_time_ms:
     *                   type: integer
     *       404:
     *         description: Execution not found
     *       500:
     *         description: Internal server error
     */
    async getExecution(req: Request, res: Response): Promise<void> {
        try {
            const { execution_id } = req.params;
            const execution = await this.executionService.getExecution(execution_id as string);

            res.status(200).json({
                execution_id: execution.id,
                status: execution.status,
                stdout: execution.stdout || "",
                stderr: execution.stderr || "",
                execution_time_ms: execution.executionTimeMs || 0
            });
        } catch (error: any) {
            if (error.message === "EXECUTION_NOT_FOUND") {
                res.status(404).json({ error: "Execution not found" });
            } else {
                logger.error({ err: error, execution_id: req.params.execution_id }, "Error getting execution");
                res.status(500).json({ error: "Internal server error" });
            }
        }
    }

    /**
     * @swagger
     * /executions/slow-jobs:
     *   get:
     *     summary: Monitor slow jobs (delay in queue)
     *     responses:
     *       200:
     *         description: List of slow executions sorted by queue delay
     *       500:
     *         description: Internal server error
     */
    async getSlowJobs(req: Request, res: Response): Promise<void> {
        try {
            const slowJobs = await this.executionService.getSlowJobs();
            // Since this is raw SQL, Prisma might return numbers as bigints or dates as objects depending on driver.
            // A simple JSON format works for us.
            const serialized = JSON.stringify(slowJobs, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            );
            res.status(200).type('json').send(serialized);
        } catch (error: any) {
            logger.error({ err: error }, "Error monitoring slow jobs");
            res.status(500).json({ error: "Internal server error" });
        }
    }
}

