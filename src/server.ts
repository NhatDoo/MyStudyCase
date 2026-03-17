import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { CodeSessionController } from "./controllers/codeSession.controller";
import { codeSessionService } from "./services/codeSession.service";
import { executionService } from "./services/execution.service";
import { executionQueue } from "./queues/execution.queue";
import { setupSwagger } from "./swagger";
import { logger } from "./utils/logger";

const codeSessionController = new CodeSessionController(codeSessionService, executionService);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

setupSwagger(app);

const runRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 requests per `window` (here, per minute)
    message: { error: "Too many execution requests, please try again later." }
});

app.post("/code-sessions", (req, res) => codeSessionController.createSession(req, res));
app.patch("/code-sessions/:session_id", (req, res) => codeSessionController.updateSession(req, res));
app.post("/code-sessions/:session_id/run", runRateLimiter, (req, res) => codeSessionController.runSession(req, res));
app.get("/executions/slow-jobs", (req, res) => codeSessionController.getSlowJobs(req, res));
app.get("/executions/:execution_id", (req, res) => codeSessionController.getExecution(req, res));

// Global Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error({ err, url: req.url, method: req.method }, "Unhandled error occurred");
    res.status(500).json({ error: "Internal server error" });
});

app.listen(port, async () => {
    logger.info(`Server is running on port ${port}`);
    await executionQueue.connect();
    logger.info(`Swagger docs available at http://localhost:${port}/api-docs`);
});
