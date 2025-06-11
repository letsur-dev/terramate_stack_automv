import { spinner, log } from '@clack/prompts';
import path from 'path';
import os from 'os';
import { spawnPromise } from './spawn.js';
import { promises as fs } from 'fs';
import fsExtra from 'fs-extra';

function getFormattedDateTimeYYYYMMDD_HHmmSS() {
    const now = new Date(); // 현재 날짜와 시간을 가져옵니다.

    // 각 시간 구성 요소를 문자열로 변환하고, 필요하면 앞에 '0'을 채워 두 자리로 만듭니다.
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0'); // 월 (0부터 시작하므로 +1 해줍니다)
    const day = String(now.getDate()).padStart(2, '0');       // 일
    const hours = String(now.getHours()).padStart(2, '0');     // 시 (24시간 형식)
    const minutes = String(now.getMinutes()).padStart(2, '0'); // 분
    const seconds = String(now.getSeconds()).padStart(2, '0'); // 초

    // 구성된 문자열을 요청하신 'MMDD_HHmmSS' 형식으로 조합합니다.
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// 사용자가 선택한 내용을 넘겨받아 처리하는 함수
export async function applyStateMovements(tfdirs, workspace, moves, userChoices) {
    const s = spinner();
    const workingDir = path.join('states', getFormattedDateTimeYYYYMMDD_HHmmSS(), workspace);
    await fs.mkdir(workingDir, {recursive: true});

    s.start("Pull TFState & Create Backups");
    // 우선 tfstate pull 및 backup 생성
    for (const tfdir of tfdirs) {
        const filename = path.basename(tfdir);
        let result = await spawnPromise('terraform',
            ['state', 'pull'], 
            {
                cwd: tfdir,
                env: {
                    ...process.env,
                    TF_WORKSPACE: workspace,
                    KUBE_CONFIG_PATH: path.join(os.homedir(), '.kube', 'config')
                }
            }
        );

        if (result.code != 0) {
            log.warn(result.stderr);
        } else {
            try {
                await fs.writeFile(
                    path.join(workingDir, `${filename}.tfstate`), result.stdout, 'utf8');
            } catch(err) {
                log.warn(err.toString());
            }
        }
    }

    await fsExtra.copy(workingDir, `${workingDir}_backup`);

    s.stop("Pull TFState & Create Backups");

    // moves를 순회 돌면서 작업 진행
    s.start("Apply Moves");
    for (let i = 0; i < moves.length; i++) {
        if (userChoices.includes(i)) {
            await applyStateMovement(moves[i]);
        } else {
            continue;
        }
    }

    s.stop("Apply Moves");

    // 작업 완료 후 S3에 다시 업로드
    s.start("Push TFState");

    s.stop("Push TFState");
}

async function applyStateMovement(movement) {

}