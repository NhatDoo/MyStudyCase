async function simulateUser(userName: string, delayMs: number = 0) {
    if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    console.log(`[${userName}] is running code...`);

    // Simulate user writing varying code that takes an amount of time to execute.
    // Python code that sleeps for 2 seconds to make the test noticeable.
    const sourceCode = `import time\nprint("Hello from ${userName}")\ntime.sleep(2)\nprint("${userName} finished")`;

    try {
        // 1. Create session
        const createRes = await fetch("http://localhost:3000/code-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: "python", sourceCode })
        });
        const sessionData = await createRes.json();
        const sessionId = sessionData.session_id;

        // 2. Queue run
        const runRes = await fetch(`http://localhost:3000/code-sessions/${sessionId}/run`, {
            method: "POST"
        });
        const runData = await runRes.json();
        const executionId = runData.execution_id;

        console.log(`[${userName}] Got Execution ID: ${executionId} (Status: ${runData.status})`);

        // 3. Poll for result quickly
        let execution;
        while (true) {
            const checkRes = await fetch(`http://localhost:3000/executions/${executionId}`);
            execution = await checkRes.json();

            if (execution.status === 'COMPLETED' || execution.status === 'FAILED' || execution.status === 'TIMEOUT') {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n🎉 [${userName}] DONE!`);
        console.log(`   Status: ${execution.status}`);
        console.log(`   Time: ${execution.execution_time_ms}ms`);
        console.log(`   Output:\n${execution.stdout.trim()}`);

    } catch (e: any) {
        console.error(`[${userName}] Error:`, e.message);
    }
}

async function main() {
    console.log("🚀 Starting Load Test for Multiple Users (Parallel) 🚀\n");

    const users = ["User_A", "User_B", "User_C", "User_D", "User_E"];

    // Fire all users at the same time (Promise.all)
    const promises = users.map(user => simulateUser(user));

    await Promise.all(promises);

    console.log("\n✅ All users finished execution in parallel!");

    // Ask server for slow jobs stats
    try {
        const statsRes = await fetch("http://localhost:3000/executions/slow-jobs");
        const slowJobs = await statsRes.json();
        console.log("\n📊 Monitoring Slow Jobs Queue Delay:");
        slowJobs.forEach((job: any, index: number) => {
            console.log(`   ${index + 1}. Execution: ${job.id} | Status: ${job.status} | Delay in Queue: ${job.queue_delay_ms}ms`);
        });
    } catch (e) { }

    process.exit(0);
}

main();
