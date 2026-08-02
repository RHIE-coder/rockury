/**
 * 피드백 도구의 인라인 스타일 조각 — 오버레이·도구막대·스케치판이 같이 쓴다.
 *
 * **앱의 공용 UI 부품과 디자인 토큰을 일부러 안 쓴다.** 이 도구가 필요한 순간은 화면이나
 * 부품, 토큰이 깨져 있을 때다. 거기에 얹으면 정작 그때 같이 죽는다. 그래서 전부 인라인
 * 스타일이고, 값도 앱 팔레트와 섞이지 않는 것으로 못박는다.
 */

/** 떠 있는 판 — 도구막대·목록·메모창·안내가 공유한다. */
export const PANEL: React.CSSProperties = {
  background: 'rgba(255,255,255,0.97)',
  border: '1px solid rgba(15,23,42,0.12)',
  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
  color: '#0f172a'
}

/** 판 위의 글자 버튼. */
export const BTN: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  borderRadius: 8,
  padding: '6px 10px',
  font: '500 12px/1 system-ui, sans-serif',
  color: '#334155',
  cursor: 'pointer'
}
