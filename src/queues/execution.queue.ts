import amqp from 'amqplib';
import { logger } from '../utils/logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = 'execution_queue_v2';
const DLX_NAME = 'code_execution_dlx';
const DLQ_NAME = 'code_execution_dlq';

export interface IExecutionQueue {
    connect(): Promise<void>;
    pushExecutionJob(executionId: string, sessionId: string, language: string, sourceCode: string): Promise<void>;
}

export class ExecutionQueue implements IExecutionQueue {
    private channel: any = null;
    private connection: any = null;

    async connect() {
        if (this.channel) return;
        try {
            this.connection = await amqp.connect(RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            // 1. Assert Dead Letter Exchange (DLX)
            await this.channel.assertExchange(DLX_NAME, 'direct', { durable: true });

            // 2. Assert Dead Letter Queue (DLQ)
            await this.channel.assertQueue(DLQ_NAME, { durable: true });

            // 3. Bind DLQ to DLX
            await this.channel.bindQueue(DLQ_NAME, DLX_NAME, '');

            // 4. Assert Main Queue configured with DLX
            await this.channel.assertQueue(QUEUE_NAME, {
                durable: true,
                arguments: {
                    'x-dead-letter-exchange': DLX_NAME,
                    'x-dead-letter-routing-key': ''
                }
            });
            logger.info("Connected to RabbitMQ and DLQ assigned successfully");
        } catch (error) {
            logger.error({ err: error }, "Failed to connect to RabbitMQ");
            // In production we should retry or exit.
        }
    }

    async pushExecutionJob(executionId: string, sessionId: string, language: string, sourceCode: string) {
        if (!this.channel) {
            await this.connect();
        }
        if (!this.channel) {
            throw new Error("RabbitMQ channel not available");
        }

        const payload = {
            executionId,
            sessionId,
            language,
            sourceCode
        };

        this.channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(payload)), {
            persistent: true,
            headers: { 'x-retry-count': 0 } // Initialize retry count
        });
        logger.info({ executionId }, `Pushed job to queue`);
    }
}

export const executionQueue = new ExecutionQueue();
