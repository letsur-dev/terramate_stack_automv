import { spawn } from 'child_process';

export async function spawnPromise(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                code: code,
                stderr: stderr,
                stdout: stdout
            });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}