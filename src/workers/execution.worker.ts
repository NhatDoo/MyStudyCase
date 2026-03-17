import amqp from 'amqplib';
import { IExecutionRepository, executionRepository } from '../repositories/execution.repository';
import { IExecutor, dockerExecutor } from '../executor/docker.executor';
import { ExecutionStatus } from '../generated/prisma';
import { logger } from '../utils/logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = 'code_execution_queue';
const MAX_RETRIES = 3;

class ExecutionWorker {
    private connection: any = null;
    private channel: any = null;
    private isShuttingDown: boolean = false;

    constructor(
        private readonly executionRepo: IExecutionRepository,
        private readonly executor: IExecutor
    ) { }

    async start() {
        try {
            this.connection = await amqp.connect(RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            // Limit to processing 5 messages concurrently
            await this.channel.prefetch(5);

            await this.channel.assertQueue(QUEUE_NAME, {
                durable: true
            });

            logger.info({ queue: QUEUE_NAME }, `[*] Worker is waiting for messages.`);

            this.channel.consume(QUEUE_NAME, async (msg: any) => {
                if (this.isShuttingDown) {
                    logger.info("Worker is shutting down. Requeueing received message.");
                    this.channel.nack(msg, false, true);
                    return;
                }

                if (msg !== null) {
                    const payload = JSON.parse(msg.content.toString());
                    const headers = msg.properties.headers || {};
                    const retryCount = headers['x-retry-count'] || 0;

                    logger.info({ executionId: payload.executionId, language: payload.language, retryCount }, `Processing job`);

                    try {
                        await this.processJob(payload);
                        this.channel.ack(msg);
                    } catch (error: any) {
                        logger.error({ executionId: payload.executionId, err: error }, `Job failed processing systematically`);

                        if (retryCount >= MAX_RETRIES) {
                            logger.warn({ executionId: payload.executionId }, `Job exceeded max retries. Sending to Dead Letter Queue (DLQ).`);

                            // Mark DB as definitely FAILED
                            await this.executionRepo.update(payload.executionId, {
                                status: ExecutionStatus.FAILED,
                                stderr: String(error.message).slice(0, 5000),
                                completedAt: new Date()
                            });

                            // Reject without requeue -> rabbitmq moves it to DLX -> DLQ
                            this.channel.nack(msg, false, false);
                        } else {
                            logger.info({ executionId: payload.executionId, nextRetry: retryCount + 1 }, `Requeueing job for retry`);

                            // Republish with incremented retry count
                            const newHeaders = { ...headers, 'x-retry-count': retryCount + 1 };
                            this.channel.sendToQueue(QUEUE_NAME, msg.content, {
                                persistent: true,
                                headers: newHeaders
                            });

                            // Ack the old one so it leaves front of line
                            this.channel.ack(msg);
                        }
                    }
                }
            }, { noAck: false });

        } catch (error) {
            logger.error({ err: error }, "Failed to start worker");
        }
    }

    private async processJob(payload: { executionId: string, sessionId: string, language: string, sourceCode: string }) {
        const startTime = new Date();

        // Update to WAITING via Repository when picked up by the worker
        await this.executionRepo.update(payload.executionId, {
            status: ExecutionStatus.WAITING,
        });

        // Update to RUNNING via Repository right before starting the container
        await this.executionRepo.update(payload.executionId, {
            status: ExecutionStatus.RUNNING,
            startedAt: startTime
        });

        // Execute logic using Docker service
        const result = await this.executor.execute(payload.language, payload.sourceCode);

        // Determine resulting status
        let finalStatus: ExecutionStatus = ExecutionStatus.COMPLETED;
        if (result.memoryLimitExceeded) {
            finalStatus = ExecutionStatus.FAILED;
        } else if (result.timeout) {
            finalStatus = ExecutionStatus.TIMEOUT;
        } else if (result.stderr && result.stderr.length > 0) {
            finalStatus = ExecutionStatus.FAILED;
        }

        // Update record as finished
        await this.executionRepo.update(payload.executionId, {
            status: finalStatus,
            stdout: result.stdout?.slice(0, 5000) ?? null,
            stderr: result.stderr?.slice(0, 5000) ?? null,
            executionTimeMs: result.executionTimeMs,
            completedAt: new Date()
        });

        logger.info({ executionId: payload.executionId, duration: result.executionTimeMs, status: finalStatus }, `Job finished`);
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        logger.info("Received shutdown signal. Closing RabbitMQ connection gracefully...");

        try {
            if (this.channel) await this.channel.close();
            if (this.connection) await this.connection.close();
            logger.info("RabbitMQ connection closed. Worker stopped successfully.");
            process.exit(0);
        } catch (error) {
            logger.error({ err: error }, "Error during worker shutdown");
            process.exit(1);
        }
    }
}

export const executionWorker = new ExecutionWorker(executionRepository, dockerExecutor);

// Boot the worker automatically when this file is run
executionWorker.start();

// --- 🛡️ PRODUCTION READY SHIELDS ---

// 1. Graceful Shutdown (Bắt cờ SIGINT/SIGTERM từ Docker hoặc lúc user nhấn Ctrl+C)
process.on('SIGINT', () => executionWorker.shutdown());
process.on('SIGTERM', () => executionWorker.shutdown());

// 2. Global Unhandled Error Catchers (Tránh văng sập server mà không lưu log)
process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught Exception detected! Shutting down systematically...');
    executionWorker.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled Promise Rejection detected! Shutting down systematically...');
    executionWorker.shutdown();
});
