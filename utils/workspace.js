import { select, log, isCancel, cancel, spinner } from '@clack/prompts';
import { spawnPromise } from './spawn.js';
import { promises as fs } from 'fs'; // fs.promises를 사용하여 Promise 기반 API 사용
import path from 'path';

// Workspace 리스트를 가져와 리스트로 반납하는 함수
export async function getWorkspaceList(directoryPath) {
    // 해당 Path 내에서 workspace list 받아오기
    try {
        let result = await spawnPromise('terraform', ['workspace', 'list'], {cwd: directoryPath});
        if (result.code != 0) {
            log.error(result.stderr.toString());
            return [];
        }
        else {
            return result.stdout.toString().split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0)
                        .map(line => line.replace(/^\*\s*/, ''));
        }
    } catch (err) {
        log.warn(err.message);
        return [];
    }
}

// TF 파일 있는 폴더 내에서 Workspace 가져와 합쳐서 옵션으로 제공하는 함수
export async function workspaceMultiSelect(pathList) {
    const s = spinner();

    s.start('Detecting the terraform workspaces');
    // 우선 Set으로 workspace 합치기
    let workspaceSet = new Set();
    for (const directoryPath of pathList) {
        let workspaceList = await getWorkspaceList(directoryPath);
        workspaceList.forEach(workspaceSet.add, workspaceSet);
    }

    // 합쳐진 set을 다시 array로
    let workspaceList = Array.from(workspaceSet);
    
    // array를 갖고 select 옵션 생성하기
    let workspaceSelectOption = workspaceList.map(workspace => {
        return {label: workspace, value: workspace};
    });

    s.stop('Detecting the terraform workspaces');

    // 질문 던지기
    let my_selection= await select({
        message: "Pick a workspace.",
        options: workspaceSelectOption
    });

    if (isCancel(my_selection)) {
        cancel("Operation Cancelled.");
        process.exit(0);
    }

    return my_selection;
}

// TF 파일이 있는 폴더만 골라서 뽑아내기
export async function findTFfolders(directoryPath) {
    const matchingFolders = new Set(); // 중복 방지를 위해 Set 사용

    // 초기 탐색 시작 폴더의 정규화된 경로
    const rootPath = path.resolve(directoryPath);

    async function traverse(currentPath) {
        try {
            const dirents = await fs.readdir(currentPath, { withFileTypes: true });

            for (const dirent of dirents) {
                const fullPath = path.join(currentPath, dirent.name);

                if (dirent.isDirectory()) {
                    // 디렉토리면 재귀적으로 탐색
                    await traverse(fullPath);
                } else if (dirent.isFile() && dirent.name === 'stack.tm.hcl') {
                    // stack.tm.hcl 파일을 찾았을 경우
                    try {
                        const fileContent = await fs.readFile(fullPath, 'utf8');
                        if (fileContent.includes('script "plan-json"')) {
                            // 문자열이 존재하면 현재 폴더를 목록에 추가
                            matchingFolders.add(currentPath);
                        }
                    } catch (readError) {
                        // 파일 읽기 오류 (예: 권한 없음, 파일 손상)는 경고만 출력하고 넘어감
                        console.warn(`Could not read file ${fullPath}: ${readError.message}`);
                    }
                }
            }
        } catch (dirError) {
            // 디렉토리 읽기 오류 (예: 권한 없음, 존재하지 않음)는 경고만 출력하고 넘어감
            console.warn(`Could not access directory ${currentPath}: ${dirError.message}`);
        }
    }

    await traverse(rootPath);
    return Array.from(matchingFolders); // Set을 Array로 변환하여 반환
}