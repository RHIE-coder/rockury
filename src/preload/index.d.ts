import type { RockuryApi } from './index'

declare global {
  interface Window {
    rockury: RockuryApi
  }
}
