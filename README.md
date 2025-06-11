## Terraform State AutoMove
- 작성자: 이정원 (jwlee@letsur.ai)

### Requirements
- terraform
- terramate
- nodejs

### 프로그램 설명
- `automv.js`: 주어진 경로 하위에 존재하는 Terraform 작업 폴더들을 탐지하고 workspace를 선택하면 tf plan 결과로부터 변화가 발생한 resource들을 탐지하여 사용자에게 move할 resource 목록을 제시하고 선택된 resource 변화 사항들을 tfstate에 자동 반영하는 프로그램
    - Terraform 작업 폴더는 반드시 terramate로 관리되고 있어 `stack.tm.hcl` 파일이 존재해야 하고, 그 `stack.tm.hcl` 파일 내에 script로 `plan-json`이라는 `terraform plan` 결과를 추출 후 `tf.plan` 및 `tf.json`을 저장하는 내용이 적혀있어야한다.
    - 작업은 저장된 `tf.json` 파일로부터 유사도 높은 creation 및 deletion을 탐지하는 과정과 tfstate를 `terraform state pull`을 통해 `./state/YYYYMMDD_HHmmSS/workspace` 폴더로 저장하여 그 안에서 `terraform state mv`를 수행 후 다시 `terraform state push`를 통해 내용을 반영하는 방식으로 되어 있다. Rollback을 위해 `./state/YYYYMMDD_HHmmSS/workspace_backup`에 원본 tfstate를 복사해둔다.
    - 사용법: `node automv.js <Terramate로 관리되는 최상위 폴더>`

- `restore.js`: `./state` 하위에 존재하는 백업을 사용하여 TFstate를 백업된 내용으로 되돌리는 프로그램
    - 사용법: `node restore.js <Terramate로 관리되는 최상위 폴더>`