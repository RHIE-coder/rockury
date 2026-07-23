import { useEffect, useRef } from 'react'

/**
 * 팝오버/드롭다운/컨텍스트 메뉴를 **바깥 클릭·Esc·스크롤/리사이즈**로 닫는다.
 * 반환한 ref 를 닫히길 원하는 컨테이너에 걸면, 그 바깥에서 눌렀을 때 onClose 가 불린다.
 * (이 앱의 여러 툴바 드롭다운·트리 우클릭 메뉴가 바깥을 눌러도 안 닫히던 문제를 공용으로 해결.)
 *
 * @param active 메뉴가 열려 있을 때만 리스너를 건다.
 * @param onClose 닫기 콜백.
 */
export function useOutsideClose<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const cb = useRef(onClose)
  cb.current = onClose
  useEffect(() => {
    if (!active) return
    const isOutside = (target: EventTarget | null): boolean => !ref.current || !ref.current.contains(target as Node)
    const onPointerDown = (e: MouseEvent): void => { if (isOutside(e.target)) cb.current() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') cb.current() }
    // 바깥 스크롤이면 닫고, 팝오버 내부(스크롤 목록 등) 스크롤이면 유지.
    const onScroll = (e: Event): void => { if (isOutside(e.target)) cb.current() }
    const onResize = (): void => cb.current()
    // capture=true 로 걸어 내부에서 stopPropagation 해도 바깥 판정이 동작하게 한다.
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [active])
  return ref
}
