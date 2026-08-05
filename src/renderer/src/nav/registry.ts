import type { Service } from './types'
import { provideRegistry } from './registryRef'
import { dbService } from '../services/db'
import { uiuxService } from '../services/uiux'
import { apiService } from '../services/api'
import { infraService } from '../services/infra'
import { aiService } from '../services/ai'

/**
 * 좌측 레일에 표시되는 서비스 순서.
 * 새 서비스는 이 배열에 등록만 하면 셸이 자동으로 크롬을 구성한다.
 */
export const registry: Service[] = [uiuxService, apiService, dbService, infraService, aiService]

// `useNav` 에게 트리를 건넨다 — 저쪽이 이 파일을 직접 임포트하면 임포트가 고리를 이뤄
// 파일 읽는 순서에 따라 앱이 안 뜬다(`registryRef` 주석에 그 사고가 적혀 있다).
provideRegistry(() => registry)
