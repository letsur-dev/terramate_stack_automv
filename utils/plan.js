import { log } from '@clack/prompts';
import { spawnPromise } from './spawn.js';
import { promises as fs } from 'fs'; // fs.promises를 사용하여 Promise 기반 API 사용
import path from 'path';
import os from 'os';

// 주어진 경로 내에서 plan-json을 돌려서 tf.json을 얻어내는 함수
async function getPlanJsonContentFromPath(directoryPath, workspace) {
  try {
    let result = await spawnPromise('terramate',
      ['script', 'run', 'plan-json'],
      {
        cwd: directoryPath,
        env: {
          ...process.env,
          TM_DISABLE_SAFEGUARDS: 'all',
          WORKSPACE: workspace,
          PATH: `/opt/homebrew/bin:${process.env.PATH}`,
          KUBE_CONFIG_PATH: path.join(os.homedir(), '.kube', 'config')
        }
      }
    );
  
    if (result.code != 0) {
      log.error(result.stderr);
      return null;
    }

    const jsonFile = await fs.readFile(path.join(directoryPath, 'tf.json'), { encoding: 'utf-8' });
    const jsonData = JSON.parse(jsonFile);
    await fs.rm(path.join(directoryPath, 'tf.json'));
    await fs.rm(path.join(directoryPath, 'tf.plan'));
    return jsonData;
  } 
  catch (err) {
    log.error(err.message);
    await fs.rm(path.join(directoryPath, 'tf.json'));
    await fs.rm(path.join(directoryPath, 'tf.plan'));
    return null;
  }
}

// 전체 경로 목록의 plan json 내용을 모아두는 함수
export async function getPlanJsonContent(pathList, workspace) {
  let planObject = new Map();

  for (const directoryPath of pathList) {
    let json = await getPlanJsonContentFromPath(directoryPath, workspace);
    if (json != null) {
      planObject.set(directoryPath, json);
    }
  }

  return planObject;
}

/**
 * Terraform Plan JSON 분석을 통한 리소스 이동 감지
 */

export class TerraformMoveDetector {
  constructor(planMap) {
    this.planMap = planMap; // Map<path, planJsonObject>
    this.moveDetections = [];
  }

  /**
   * 메인 함수: 모든 plan에서 리소스 이동을 감지
   */
  detectResourceMoves() {
    const allCreations = this.extractResourceActions('create');
    const allDeletions = this.extractResourceActions('delete');
    
    log.info(`Found ${allCreations.length} creations and ${allDeletions.length} deletions`);
    
    // 각 삭제 리소스에 대해 매칭되는 생성 리소스 찾기
    for (const deletion of allDeletions) {
      const matchingCreation = this.findMatchingCreation(deletion, allCreations);
      
      if (matchingCreation) {
        this.moveDetections.push({
          from: {
            path: deletion.path,
            address: deletion.address,
            resourceType: deletion.resourceType,
            name: deletion.name
          },
          to: {
            path: matchingCreation.path,
            address: matchingCreation.address,
            resourceType: matchingCreation.resourceType,
            name: matchingCreation.name
          },
          confidence: this.calculateMatchConfidence(deletion, matchingCreation),
          reason: this.getMatchReason(deletion, matchingCreation)
        });
      }
    }
    
    return this.moveDetections;
  }

  /**
   * 특정 액션(create/delete)의 리소스들을 모든 plan에서 추출
   */
  extractResourceActions(action) {
    const resources = [];
    
    for (const [path, planJson] of this.planMap) {
      if (!planJson || !planJson.resource_changes) continue;
      
      for (const change of planJson.resource_changes) {
        if (change.change && change.change.actions.includes(action)) {
          const resource = {
            path: path,
            address: change.address,
            resourceType: change.type,
            name: change.name,
            change: change,
            // 리소스의 설정값들 (매칭에 사용)
            config: this.extractResourceConfig(change),
            // 상태값들 (삭제의 경우 before, 생성의 경우 after)
            values: action === 'delete' ? change.change.before : change.change.after
          };
          resources.push(resource);
        }
      }
    }
    
    return resources;
  }

  /**
   * 리소스의 설정값 추출 (매칭 비교용)
   */
  extractResourceConfig(change) {
    const config = {};
    
    // 설정값이 있는 경우
    if (change.change && change.change.after) {
      config.after = change.change.after;
    }
    
    if (change.change && change.change.before) {
      config.before = change.change.before;
    }
    
    return config;
  }

  /**
   * 삭제 리소스와 매칭되는 생성 리소스 찾기
   */
  findMatchingCreation(deletion, creations) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const creation of creations) {
      // 같은 경로에서는 매칭하지 않음 (실제 이동이 아님)
      if (deletion.path === creation.path) continue;
      
      // 리소스 타입이 다르면 매칭하지 않음
      if (deletion.resourceType !== creation.resourceType) continue;
      
      const score = this.calculateSimilarityScore(deletion, creation);
      
      if (score > bestScore && score > 0.7) { // 임계값 70%
        bestScore = score;
        bestMatch = creation;
      }
    }
    
    return bestMatch;
  }

  /**
   * 두 리소스 간의 유사도 점수 계산
   */
  calculateSimilarityScore(deletion, creation) {
    let totalWeight = 0;
    let matchedWeight = 0;
    
    // 리소스 이름 비교 (가중치: 3)
    const nameWeight = 3;
    totalWeight += nameWeight;
    if (deletion.name === creation.name) {
      matchedWeight += nameWeight;
    } else if (this.isNamesimilar(deletion.name, creation.name)) {
      matchedWeight += nameWeight * 0.5;
    }
    
    // 리소스 설정값 비교 (가중치: 5)
    const configWeight = 5;
    totalWeight += configWeight;
    const configSimilarity = this.compareResourceConfigs(deletion.values, creation.values);
    matchedWeight += configWeight * configSimilarity;
    
    // 리소스 타입은 이미 같다고 확인했으므로 (가중치: 2)
    const typeWeight = 2;
    totalWeight += typeWeight;
    matchedWeight += typeWeight;
    
    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }

  /**
   * 리소스 이름 유사성 검사
   */
  isNamesimilar(name1, name2) {
    // 언더스코어나 하이픈 제거 후 비교
    const clean1 = name1.replace(/[-_]/g, '').toLowerCase();
    const clean2 = name2.replace(/[-_]/g, '').toLowerCase();
    
    return clean1 === clean2 || 
           clean1.includes(clean2) || 
           clean2.includes(clean1);
  }

  /**
   * 두 리소스 설정의 유사성 비교
   */
  compareResourceConfigs(config1, config2) {
    if (!config1 || !config2) return 0;
    
    const keys1 = new Set(Object.keys(config1));
    const keys2 = new Set(Object.keys(config2));
    const allKeys = new Set([...keys1, ...keys2]);
    
    let matchingKeys = 0;
    let totalKeys = allKeys.size;
    
    for (const key of allKeys) {
      // ID나 ARN 같은 자동 생성 필드는 제외
      if (this.isAutoGeneratedField(key)) {
        totalKeys--; // 비교 대상에서 제외
        continue;
      }
      
      const val1 = config1[key];
      const val2 = config2[key];
      
      if (this.deepEqual(val1, val2)) {
        matchingKeys++;
      } else if (this.isValueSimilar(val1, val2)) {
        matchingKeys += 0.5; // 부분 점수
      }
    }
    
    return totalKeys > 0 ? matchingKeys / totalKeys : 0;
  }

  /**
   * 자동 생성 필드인지 확인
   */
  isAutoGeneratedField(key) {
    const autoFields = [
      'id', 'arn', 'self_link', 'creation_date', 'last_modified',
      'etag', 'version', 'fingerprint', 'unique_id'
    ];
    
    return autoFields.some(field => 
      key === field || 
      key.endsWith('_id') || 
      key.endsWith('_arn') ||
      key.includes('time') ||
      key.includes('date')
    );
  }

  /**
   * 값의 유사성 검사
   */
  isValueSimilar(val1, val2) {
    if (typeof val1 !== typeof val2) return false;
    
    if (typeof val1 === 'string') {
      // 문자열의 경우 공백 정규화 후 비교
      const clean1 = val1.replace(/\s+/g, ' ').trim();
      const clean2 = val2.replace(/\s+/g, ' ').trim();
      return clean1 === clean2;
    }
    
    return false;
  }

  /**
   * 깊은 객체 비교
   */
  deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return obj1 === obj2;
    if (typeof obj1 !== typeof obj2) return false;
    
    if (typeof obj1 === 'object') {
      if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;
      
      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      
      if (keys1.length !== keys2.length) return false;
      
      for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!this.deepEqual(obj1[key], obj2[key])) return false;
      }
      
      return true;
    }
    
    return obj1 === obj2;
  }

  /**
   * 매칭 신뢰도 계산
   */
  calculateMatchConfidence(deletion, creation) {
    return this.calculateSimilarityScore(deletion, creation);
  }

  /**
   * 매칭 이유 설명
   */
  getMatchReason(deletion, creation) {
    const reasons = [];
    
    if (deletion.name === creation.name) {
      reasons.push('같은 리소스 이름');
    } else if (this.isNamesimilar(deletion.name, creation.name)) {
      reasons.push('유사한 리소스 이름');
    }
    
    if (deletion.resourceType === creation.resourceType) {
      reasons.push('같은 리소스 타입');
    }
    
    const configSimilarity = this.compareResourceConfigs(deletion.values, creation.values);
    if (configSimilarity > 0.8) {
      reasons.push('높은 설정 일치도');
    } else if (configSimilarity > 0.5) {
      reasons.push('보통 설정 일치도');
    }
    
    return reasons.join(', ');
  }

  /**
   * 같은 모듈인지 확인
   */
  isSameModule(path1, path2) {
    // 단순히 경로가 같은지 확인 (실제로는 더 복잡한 로직 필요)
    return path1 === path2;
  }

  /**
   * 감지 결과 요약 출력
   */
  printSummary() {
    console.log(`\n=== Terraform 리소스 이동 감지 결과 ===`);
    console.log(`총 ${this.moveDetections.length}개의 리소스 이동이 감지되었습니다.\n`);
    
    for (let i = 0; i < this.moveDetections.length; i++) {
      const detection = this.moveDetections[i];
      console.log(`${i + 1}. ${detection.from.resourceType}.${detection.from.name}`);
      console.log(`   From: ${detection.from.path} -> ${detection.from.address}`);
      console.log(`   To:   ${detection.to.path} -> ${detection.to.address}`);
      console.log(`   신뢰도: ${(detection.confidence * 100).toFixed(1)}%`);
      console.log(`   이유: ${detection.reason}\n`);
    }
  }

  // 감지 결과로 MultiSelect 옵션 생성하기
  makeMultiSelectOptions() {
    log.info(`Total ${this.moveDetections.length} movements detected`);
    let options = [];
    
    for (let i = 0; i < this.moveDetections.length; i++) {
      const detection = this.moveDetections[i];
      let label = `${detection.from.resourceType}.${detection.from.name}`;
      label += `\n│  From:   ${detection.from.path} -> ${detection.from.address}`;
      label += `\n│  To:     ${detection.to.path} -> ${detection.to.address}`;
      label += `\n│  신뢰도:   ${(detection.confidence * 100).toFixed(1)}%`;
      label += `\n│  Reason: ${detection.reason}`;

      options.push({value: i, label: label});
    }

    return options;
  }
}