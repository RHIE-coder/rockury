import type { Service } from './types'
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
