import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const QUEUE_NAME = 'code_execution_queue';

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
            this.connection = await amqp.connect(RABBITMQ_URL!);
            this.channel = await this.connection.createChannel();
            await this.channel.assertQueue(QUEUE_NAME, {
                durable: true
            });
            console.log("Connected to RabbitMQ and queue asserted");
        } catch (error) {
            console.error("Failed to connect to RabbitMQ", error);
            // We might not want to throw immediately on startup, 
            // but log the error. In production we should retry or exit.
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
            persistent: true
        });
        console.log(`Pushed job for execution ${executionId} to queue`);
    }
}

export const executionQueue = new ExecutionQueue();
