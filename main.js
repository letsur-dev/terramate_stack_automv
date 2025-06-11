import { intro, outro, spinner, multiselect } from '@clack/prompts';
import { findTFfolders, workspaceMultiSelect } from './utils/workspace.js';
import { getPlanJsonContent, TerraformMoveDetector } from './utils/plan.js';
import { applyStateMovements } from './utils/state.js';

// 메인 함수
const s = spinner();

intro(`TFstate Auto Move`);

// 우선 작업 폴더 내 TF 작업 폴더들 조회하기
s.start('Detecting the terraform directories');
let tfdirs = await findTFfolders("/Users/korjwl1/Documents/terraform-infra");
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

    // 고른 move를 적용하기
    await applyStateMovements(tfdirs, workspace, moves, moves_chosen);
}



outro(`TFstate Auto Move done!`);
