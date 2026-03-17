// Phương án tối ưu nhất nếu triển khai trên VPS hoặc Server chuyên dụng

import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';

interface ExecutionResult {
    stdout: string;
    stderr: string;
    executionTimeMs: number;
    timeout: boolean;
    memoryLimitExceeded: boolean;
}

export interface IExecutor {
    execute(language: string, sourceCode: string): Promise<ExecutionResult>;
}

interface LanguageConfig {
    extension: string;
    image: string;
    getCommandArgs: (fileName: string) => string[];
}

const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
    python: {
        extension: 'py',
        image: 'python:3.9-alpine',
        getCommandArgs: (fileName) => ['python', `/app/${fileName}`]
    },
    javascript: {
        extension: 'js',
        image: 'node:18-alpine',
        getCommandArgs: (fileName) => ['node', `/app/${fileName}`]
    },
    nodejs: {
        extension: 'js',
        image: 'node:18-alpine',
        getCommandArgs: (fileName) => ['node', `/app/${fileName}`]
    }
};

export class DockerExecutor implements IExecutor {
    async execute(language: string, sourceCode: string): Promise<ExecutionResult> {
        return new Promise(async (resolve, reject) => {
            const tempDir = path.join(process.cwd(), 'tmp');
            try {
                await fs.mkdir(tempDir, { recursive: true });
            } catch (e) { }

            const fileId = crypto.randomUUID();

            const config = SUPPORTED_LANGUAGES[language];
            if (!config) {
                return reject(new Error('Unsupported language: ' + language));
            }

            const fileName = `main_${fileId}.${config.extension}`;
            const image = config.image;
            const commandArgs = config.getCommandArgs(fileName);

            const filePath = path.join(tempDir, fileName);
            await fs.writeFile(filePath, sourceCode);

            const startTime = Date.now();
            let stdoutData = '';
            let stderrData = '';
            let isTimeout = false;

            // Notice we replace backslashes to ensure clean docker mounting on Windows
            const tempDirContainer = tempDir.replace(/\\/g, '/');

            const childProcess = spawn('docker', [
                'run',
                '--rm',             // Remove container automatically when it exits
                '--memory=128m',    // Prevent excessive memory use
                '--cpus=0.5',       // Prevent maxing out CPU
                '--network=none',   // Disable internet access inside container
                '-v',
                `${tempDirContainer}:/app`, // Mount our temp dir inside container
                image,
                ...commandArgs
            ]);

            const timeoutId = setTimeout(() => {
                isTimeout = true;
                childProcess.kill();
            }, 10000); // 10 seconds timeout limit

            childProcess.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            childProcess.stderr.on('data', (data) => {
                stderrData += data.toString();
            });

            childProcess.on('close', async (code) => {
                clearTimeout(timeoutId);
                const executionTimeMs = Date.now() - startTime;

                let memoryLimitExceeded = false;
                // Code 137 in Docker (128 + 9) usually means process was killed via SIGKILL (OOM Killer)
                if (code === 137) {
                    memoryLimitExceeded = true;
                    stderrData += "\nError: Memory limit exceeded.";
                }

                try {
                    await fs.unlink(filePath);
                } catch (e) { }

                resolve({
                    stdout: stdoutData,
                    stderr: stderrData,
                    executionTimeMs,
                    timeout: isTimeout,
                    memoryLimitExceeded
                });
            });

            childProcess.on('error', async (err) => {
                clearTimeout(timeoutId);
                try {
                    await fs.unlink(filePath);
                } catch (e) { }
                reject(err);
            });
        });
    }
}

export const dockerExecutor = new DockerExecutor();
