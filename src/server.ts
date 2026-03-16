import express from "express";
import rateLimit from "express-rate-limit";
import { codeSessionController } from "./controllers/codeSession.controller";
import { executionQueue } from "./queues/execution.queue";
import { setupSwagger } from "./swagger";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

setupSwagger(app);

const runRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 requests per `window` (here, per minute)
    message: { error: "Too many execution requests, please try again later." }
});

app.post("/code-sessions", codeSessionController.createSession);
app.patch("/code-sessions/:session_id", codeSessionController.updateSession);
app.post("/code-sessions/:session_id/run", runRateLimiter, codeSessionController.runSession);
app.get("/executions/slow-jobs", codeSessionController.getSlowJobs);
app.get("/executions/:execution_id", codeSessionController.getExecution);

app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);
    await executionQueue.connect();
    console.log(`http://localhost:${port}/api-docs`);
});
