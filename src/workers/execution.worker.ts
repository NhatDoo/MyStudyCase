import amqp from 'amqplib';
import { IExecutionRepository, executionRepository } from '../repositories/execution.repository';
import { IExecutor, dockerExecutor } from '../executor/docker.executor';
import { ExecutionStatus } from '../generated/prisma';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = 'code_execution_queue';

class ExecutionWorker {
    private connection: any = null;
    private channel: any = null;

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

            console.log(`[*] Worker is waiting for messages in ${QUEUE_NAME} queue.`);

            this.channel.consume(QUEUE_NAME, async (msg: any) => {
                if (msg !== null) {
                    const payload = JSON.parse(msg.content.toString());
                    console.log(`[x] Processing job: ${payload.executionId} (Language: ${payload.language})`);

                    await this.processJob(payload);
                    this.channel.ack(msg);
                }
            }, { noAck: false });

        } catch (error) {
            console.error("Failed to start worker", error);
        }
    }

    private async processJob(payload: { executionId: string, sessionId: string, language: string, sourceCode: string }) {
        const startTime = new Date();
        try {
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

            console.log(`[v] Job ${payload.executionId} finished in ${result.executionTimeMs}ms (Status: ${finalStatus})`);
        } catch (error: any) {
            console.error(`[!] Job ${payload.executionId} strictly failed:`, error);
            await this.executionRepo.update(payload.executionId, {
                status: ExecutionStatus.FAILED,
                stderr: String(error.message).slice(0, 5000),
                completedAt: new Date()
            });
        }
    }
}

export const executionWorker = new ExecutionWorker(executionRepository, dockerExecutor);

// Boot the worker automatically when this file is run
executionWorker.start();
