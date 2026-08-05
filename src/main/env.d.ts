/**
 * `?raw` 로 들여오는 텍스트 자원의 타입.
 *
 * 왜 번들에 문자열로 품나: 별도 파일로 두면 배포 도구의 "이 파일도 같이 넣기" 설정에
 * 숨은 의존이 생기는데, 이 프로젝트엔 아직 배포 도구 자체가 없다. 문자열이면 그냥 코드다.
 */
declare module '*.sql?raw' {
  const content: string
  export default content
}
