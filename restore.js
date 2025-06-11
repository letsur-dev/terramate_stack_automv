import { intro, outro, spinner, select, isCancel, cancel, log } from '@clack/prompts';
import path from 'path';
import { statSync, existsSync } from 'fs';
import { analyzeFolderStructure } from './utils/restore.js';
import { findTFfolders } from './utils/workspace.js';
import { spawnPromise } from './utils/spawn.js';
import os from 'os';

// ----- 경로 분석 ----- //
const args = process.argv.slice(2);
if (args.length != 1) {
    console.log("작업 경로가 전달되지 않았습니다.");
    process.exit(1);
}
let userDir = '';
if (path.isAbsolute(args[0])) {
    userDir = args[0];
} else {
    userDir = path.resolve(process.cwd(), args[0]);
}
try {
    const stats = statSync(userDir);
    if (!stats.isDirectory()) {
        console.log("작업 경로는 반드시 폴더야 합니다.");
        process.exit(1);
    }
} catch (err) {
    console.log("유효하지 않은 경로");
    process.exit(1);
}

// ----- 메인 함수 ----- //
const s = spinner();

intro(`TFstate Restore`);
// 우선 ./states에 백업된 목록 확인
const result = await analyzeFolderStructure('./states');

// 여기서 key 값만 추출하여 사용자에게 select 주기
let workspace = await select({
    message: "Pick a workspace.",
    options: Object.keys(result).map(e => {
        return {label: e, value: e};
    })
})

if (isCancel(workspace)) {
    cancel("Operation Canceled!");
    process.exit(0);
}

// key 선택 후에는 백업 선택
let backup = await select({
    message: "Pick a backup to restore.",
    options: result[workspace].map(e => {
        return {label: e, value: path.resolve(process.cwd(), 'states', e, `${workspace}_backup`)};
    })
})

if (isCancel(workspace)) {
    cancel("Operation Canceled!");
    process.exit(0);
}

// 선택한 백업으로 되돌리기
s.start("Restoring from the backup");
let tfdirs = await findTFfolders(userDir);
for (const tfdir of tfdirs) {
    const stateName = `${path.basename(tfdir)}.tfstate`;
    const statePath = path.join(backup, stateName);
    if (existsSync(statePath)) {
        let push = await spawnPromise('terraform',
            ['state', 'push', statePath, '--force'],
            {
                cwd: tfdir,
                env: {
                    ...process.env,
                    TF_WORKSPACE: workspace,
                    KUBE_CONFIG_PATH: path.join(os.homedir(), '.kube', 'config')
                }
            }
        );

        if (push.code != 0) {
            log.warn(`${stateName}: ${push.stderr}`);
        } else {

        }
    }
}

s.stop("Restoring from the backup");

outro(`TFstate Restore done!`);
