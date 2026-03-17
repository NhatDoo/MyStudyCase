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
    binary: string;
    getArgs: (filePath: string) => string[];
}

const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
    python: {
        extension: 'py',
        binary: 'python3',
        getArgs: (filePath) => [filePath]
    },
    javascript: {
        extension: 'js',
        binary: 'node',
        getArgs: (filePath) => [filePath]
    },
    nodejs: {
        extension: 'js',
        binary: 'node',
        getArgs: (filePath) => [filePath]
    }
};

const TIMEOUT_MS = 10_000;       // 10 seconds
const MAX_OUTPUT_BYTES = 5_000;  // 5KB max output

export class NativeExecutor implements IExecutor {
    async execute(language: string, sourceCode: string): Promise<ExecutionResult> {
        const config = SUPPORTED_LANGUAGES[language];
        if (!config) {
            throw new Error('Unsupported language: ' + language);
        }

        const tempDir = path.join(process.cwd(), 'tmp');
        await fs.mkdir(tempDir, { recursive: true });

        const fileId = crypto.randomUUID();
        const fileName = `main_${fileId}.${config.extension}`;
        const filePath = path.join(tempDir, fileName);

        await fs.writeFile(filePath, sourceCode, 'utf8');

        return new Promise((resolve) => {
            const startTime = Date.now();
            let stdoutData = '';
            let stderrData = '';
            let isTimeout = false;
            let settled = false;

            const child = spawn(config.binary, config.getArgs(filePath), {
                // Isolate environment — do not inherit parent's env vars
                env: {
                    PATH: process.env.PATH,
                    HOME: '/tmp'
                }
            });

            const timeoutId = setTimeout(() => {
                isTimeout = true;
                child.kill('SIGKILL');
            }, TIMEOUT_MS);

            child.stdout.on('data', (data: Buffer) => {
                stdoutData += data.toString();
                if (Buffer.byteLength(stdoutData) > MAX_OUTPUT_BYTES) {
                    stdoutData = stdoutData.slice(0, MAX_OUTPUT_BYTES) + '\n[Output truncated]';
                    child.kill('SIGKILL');
                }
            });

            child.stderr.on('data', (data: Buffer) => {
                stderrData += data.toString();
                if (Buffer.byteLength(stderrData) > MAX_OUTPUT_BYTES) {
                    stderrData = stderrData.slice(0, MAX_OUTPUT_BYTES) + '\n[Stderr truncated]';
                }
            });

            const finish = async (code: number | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);

                const executionTimeMs = Date.now() - startTime;

                // Code 137 = SIGKILL (OOM or force kill)
                const memoryLimitExceeded = code === 137 && !isTimeout;
                if (memoryLimitExceeded) {
                    stderrData += '\nError: Memory limit exceeded.';
                }

                try { await fs.unlink(filePath); } catch { }

                resolve({
                    stdout: stdoutData,
                    stderr: stderrData,
                    executionTimeMs,
                    timeout: isTimeout,
                    memoryLimitExceeded
                });
            };

            child.on('close', (code) => finish(code));
            child.on('error', async (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try { await fs.unlink(filePath); } catch { }
                resolve({
                    stdout: '',
                    stderr: `Execution error: ${err.message}`,
                    executionTimeMs: Date.now() - startTime,
                    timeout: false,
                    memoryLimitExceeded: false
                });
            });
        });
    }
}

export const nativeExecutor = new NativeExecutor();
