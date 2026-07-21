import { clsx, type ClassValue } from 'clsx'

/** className 조합 헬퍼. */
export function cx(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
