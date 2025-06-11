import fs from 'fs/promises';
import path from 'path';

/**
 * 주어진 폴더의 하위폴더들을 분석하여 workspace별로 그룹화된 객체를 생성합니다.
 * @param {string} rootPath - 분석할 루트 폴더 경로
 * @returns {Promise<Object>} workspace별로 그룹화된 폴더 정보 객체
 */
export async function analyzeFolderStructure(rootPath) {
    try {
        // 루트 폴더의 모든 항목 읽기
        const items = await fs.readdir(rootPath, { withFileTypes: true });

        // 디렉토리만 필터링
        const directories = items.filter(item => item.isDirectory());

        // YYYYMMDD_HHmmSS 패턴 검증을 위한 정규식
        const dateTimePattern = /^\d{8}_\d{6}$/;

        const result = {};

        for (const dir of directories) {
            const dirName = dir.name;

            // YYYYMMDD_HHmmSS 패턴 검증
            if (!dateTimePattern.test(dirName)) {
                console.warn(`Warning: ${dirName} does not match YYYYMMDD_HHmmSS pattern`);
                continue;
            }

            const dirPath = path.join(rootPath, dirName);

            try {
                // 하위 폴더들 읽기
                const subItems = await fs.readdir(dirPath, { withFileTypes: true });
                const subDirectories = subItems.filter(item => item.isDirectory());

                for (const subDir of subDirectories) {
                    const subDirName = subDir.name;

                    // workspace 또는 workspace_backup 패턴 확인
                    if (subDirName.endsWith('_backup')) {
                        // 무시
                    } else {
                        // 일반 workspace인 경우
                        if (!result[subDirName]) {
                            result[subDirName] = [];
                        }
                        result[subDirName].push(dirName);
                    }
                }

            } catch (subDirError) {
                console.error(`Error reading subdirectory ${dirPath}:`, subDirError.message);
            }
        }

        return result;

    } catch (error) {
        console.error('Error analyzing folder structure:', error.message);
        throw error;
    }
}