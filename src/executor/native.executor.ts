// Phương án này chỉ được sử dụng cho mục đích Demo , sẽ có rũi ro khi triển khai trên môi trường thực tế

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

// ─── Python Security Wrapper ───────────────────────────────────────────────────
// Được chạy TRƯỚC user code, thiết lập các lớp bảo mật.
// Các giới hạn kernel-level (resource module) KHÔNG thể bị user code bypass.
// Các giới hạn network/os là best-effort (language-level patch).
const PYTHON_SECURITY_WRAPPER = `\
import resource as _r, socket as _sock, os as _os, builtins as _builtins

# [1] KERNEL-ENFORCED resource limits — user code KHÔNG thể vượt qua
try:
    _r.setrlimit(_r.RLIMIT_AS,    (134_217_728, 134_217_728))  # 128MB virtual memory
    _r.setrlimit(_r.RLIMIT_NPROC, (25, 25))                     # max 25 child processes
    _r.setrlimit(_r.RLIMIT_FSIZE, (524_288, 524_288))           # max 512KB file writes
except Exception:
    pass  # Một số môi trường không hỗ trợ setrlimit

# [2] NETWORK block (best-effort — library level)
def _net_blocked(*a, **kw): raise PermissionError("Network access is blocked in sandbox")
_sock.socket.connect    = _net_blocked
_sock.socket.connect_ex = _net_blocked
_sock.create_connection = _net_blocked
_sock.getaddrinfo       = _net_blocked

# [3] OS COMMAND block (best-effort — library level)
def _deny(fn): return lambda *a, **k: (_ for _ in ()).throw(PermissionError(f"{fn}() is blocked in sandbox"))
_os.system  = _deny("os.system")
_os.popen   = _deny("os.popen")
_os.execv   = _deny("os.execv");   _os.execve = _deny("os.execve");  _os.execvp = _deny("os.execvp")
_os.fork    = _deny("os.fork");    _os.forkpty = _deny("os.forkpty")

# [4] BLOCKED MODULE imports (best-effort — import hook)
_BLOCKED_MODS = frozenset({'subprocess', 'multiprocessing', 'ctypes', 'pty', 'tty', 'termios'})
_orig_import  = _builtins.__import__
def _safe_import(name, *a, **kw):
    if name.split('.')[0] in _BLOCKED_MODS:
        raise ImportError(f"Module '{name}' is blocked in sandbox")
    return _orig_import(name, *a, **kw)
_builtins.__import__ = _safe_import

# [5] RUN user code inside isolated namespace
with open('main.py', 'r') as _f:
    _code = _f.read()
exec(compile(_code, 'main.py', 'exec'), {'__builtins__': _builtins, '__name__': '__main__'})
`;

// ─── Node.js Security Preload ──────────────────────────────────────────────────
// Được load qua --require trước khi main.js chạy.
// Override Module._load để chặn các built-in module nguy hiểm.
const NODE_SECURITY_PRELOAD = `\
'use strict';
const _Module = require('module');
const _orig   = _Module._load;
const BLOCKED = new Set([
    'child_process', 'cluster', 'dgram',
    'dns', 'http', 'http2', 'https',
    'net', 'tls', 'worker_threads',
]);
_Module._load = function (request, parent, isMain) {
    if (BLOCKED.has(request)) {
        throw new Error("Module '" + request + "' is blocked in sandbox");
    }
    return _orig.apply(this, arguments);
};
// Xóa fetch / WebSocket global (Node 18+)
try { delete globalThis.fetch;     } catch (_) {}
try { delete globalThis.WebSocket; } catch (_) {}
`;

// ─── Language Configs ──────────────────────────────────────────────────────────
interface LanguageConfig {
    extension: string;
    wrapperName: string;
    wrapperContent: string;
    getSpawnCmd: () => { binary: string; args: string[] };
}

const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
    python: {
        extension: 'py',
        wrapperName: '_runner.py',
        wrapperContent: PYTHON_SECURITY_WRAPPER,
        // ulimit: -v mem (KB), -t CPU time (s), -u processes, -f file size (512B blocks)
        getSpawnCmd: () => ({
            binary: 'sh',
            args: ['-c', 'ulimit -v 131072 -t 10 -u 25 -f 1024 2>/dev/null; python3 _runner.py'],
        }),
    },
    javascript: {
        extension: 'js',
        wrapperName: '_preload.js',
        wrapperContent: NODE_SECURITY_PRELOAD,
        getSpawnCmd: () => ({
            binary: 'node',
            args: ['--require', './_preload.js', 'main.js'],
        }),
    },
    nodejs: {
        extension: 'js',
        wrapperName: '_preload.js',
        wrapperContent: NODE_SECURITY_PRELOAD,
        getSpawnCmd: () => ({
            binary: 'node',
            args: ['--require', './_preload.js', 'main.js'],
        }),
    },
};

const TIMEOUT_MS = 10_000;  // 10 giây wall-clock timeout
const MAX_OUTPUT_BYTES = 5_000;   // 5KB max stdout/stderr

export class NativeExecutor implements IExecutor {
    async execute(language: string, sourceCode: string): Promise<ExecutionResult> {
        const config = SUPPORTED_LANGUAGES[language];
        if (!config) throw new Error('Unsupported language: ' + language);

        // Mỗi execution có 1 thư mục riêng — cô lập filesystem giữa các job
        const execId = crypto.randomUUID();
        const execDir = path.join(process.cwd(), 'tmp', `exec_${execId}`);
        await fs.mkdir(execDir, { recursive: true });

        // Ghi song song: user code + security wrapper/preload
        await Promise.all([
            fs.writeFile(path.join(execDir, `main.${config.extension}`), sourceCode, 'utf8'),
            fs.writeFile(path.join(execDir, config.wrapperName), config.wrapperContent, 'utf8'),
        ]);

        const { binary, args } = config.getSpawnCmd();

        return new Promise((resolve) => {
            const startTime = Date.now();
            let stdoutData = '';
            let stderrData = '';
            let isTimeout = false;
            let settled = false;

            const child = spawn(binary, args, {
                cwd: execDir,  // Process chạy bên trong thư mục cô lập
                env: {
                    PATH: '/usr/local/bin:/usr/bin:/bin',
                    HOME: '/tmp',
                    // Không inherit env vars từ parent process (bảo vệ secrets)
                },
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
                const memoryLimitExceeded = code === 137 && !isTimeout;
                if (memoryLimitExceeded) stderrData += '\nError: Memory limit exceeded.';

                // Dọn sạch toàn bộ thư mục execution (user code + wrapper)
                try { await fs.rm(execDir, { recursive: true, force: true }); } catch { }

                resolve({ stdout: stdoutData, stderr: stderrData, executionTimeMs, timeout: isTimeout, memoryLimitExceeded });
            };

            child.on('close', (code) => finish(code));
            child.on('error', async (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                try { await fs.rm(execDir, { recursive: true, force: true }); } catch { }
                resolve({
                    stdout: '',
                    stderr: `Execution error: ${err.message}`,
                    executionTimeMs: Date.now() - startTime,
                    timeout: false,
                    memoryLimitExceeded: false,
                });
            });
        });
    }
}

export const nativeExecutor = new NativeExecutor();
