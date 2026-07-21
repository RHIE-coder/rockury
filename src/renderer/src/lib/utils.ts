import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn 표준 className 병합 헬퍼.
 * clsx 로 조건부 결합 → tailwind-merge 로 충돌 유틸리티 정리(뒤가 이김).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
