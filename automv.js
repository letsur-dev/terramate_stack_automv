import { intro, outro, spinner, multiselect } from '@clack/prompts';
import { findTFfolders, workspaceMultiSelect } from './utils/workspace.js';
import { getPlanJsonContent, TerraformMoveDetector } from './utils/plan.js';
import { applyStateMovements } from './utils/state.js';
import path from 'path';
import { statSync } from 'fs';

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

intro(`TFstate Auto Move`);

// 우선 작업 폴더 내 TF 작업 폴더들 조회하기
s.start('Detecting the terraform directories');
let tfdirs = await findTFfolders(userDir);
if (tfdirs.length == 0) {
    outro(`No Terraform workspace found!`);
}
s.stop('Detecting the terraform directories');

// Workspace 고르게 하기
let workspace = await workspaceMultiSelect(tfdirs);

// 고른 Workspace 기반 plan 돌려서 json 추출하기
s.start('Extracting the Terraform plan json');
let planMap = await getPlanJsonContent(tfdirs, workspace);
s.stop('Extracting the Terraform plan json');

// Plan 내 움직임 감지
s.start('Detecting the movements in plans');
const detector = new TerraformMoveDetector(planMap);
const moves = detector.detectResourceMoves();
s.stop('Detecting the movements in plans');

// 사용자가 move 중 반영할 move 고를 수 있게끔
const options = detector.makeMultiSelectOptions();
if (options.length > 0) {
    const moves_chosen = await multiselect({
        message: 'Select Moves to Apply',
        options: options,
        required: false
    });

    if (moves_chosen.length > 0) {
        // 고른 move를 적용하기
        await applyStateMovements(tfdirs, workspace, moves, moves_chosen);   
    }
}

outro(`TFstate Auto Move done!`);
