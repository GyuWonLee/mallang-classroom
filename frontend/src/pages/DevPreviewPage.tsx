import { AiGeneratingView } from '@/components/classroom/teacher/modals/AiGeneratingView'

/**
 * 개발용 미리보기 화면 — `/dev/preview` (개발 서버에서만 열린다, router.tsx 참고).
 *
 * 왜 있나: 손보려는 화면들이 **잠깐만 보인다.** AI 생성 로딩은 [AI로 문제 만들기] 를 누르고
 * 10~20초, F5 로딩 화면은 100ms 다. 그 순간을 보려고 매번 로그인 → 학급 → 마법사 → 자료
 * 올리기를 반복하면 손볼 때마다 몇 분이 든다. 여기서는 세워 두고(HMR) 계속 보면서 고친다.
 *
 * **이 화면에는 손보려는 것 하나만 둔다.** 처음엔 위에 "개발용" 안내줄과 카드 테두리를 함께
 * 그렸는데, 정작 보려는 것 옆에 다른 것이 있으면 여백·크기를 그것과 견주게 되어 판단이 흐려진다.
 *
 * 지금 보고 있는 것: **AI 생성 로딩**(`AiGeneratingView`). 다른 화면을 손볼 때는 아래
 * 컴포넌트만 바꿔 끼우면 된다(예: F5 로딩은 `RouteFallback`).
 *
 * 배포 번들에는 들어가지 않는다 — 라우트가 `import.meta.env.DEV` 에서만 등록된다.
 */
export function DevPreviewPage() {
  return (
    /*
      이 화면은 과제 마법사 **모달 안**에 얹힌다. 그래서 미리보기도 그 모달과 **같은 상자**로
      둔다 — `AssignmentWizardModal` 은 `width={640}` 이고 `ModalShell` 이 그 폭에
      `rounded-[32px]` · `p-[32px_34px_30px]` · 짙은 그림자를 준다(그 값을 그대로 베꼈다).
      전에는 720px 카드에 얹어 두고 봤는데, 실제보다 80px 넓어 크기 감각이 어긋났다.

      뒤 어둠막까지 흉내 낸다 — 카드 밖 밝기가 다르면 같은 흰 카드도 다르게 보인다.
    */
    <div className="grid min-h-screen place-items-center bg-[rgba(63,61,86,.5)] p-6">
      <div
        style={{ width: 'min(640px, 100%)' }}
        className="rounded-[32px] bg-card p-[32px_34px_30px] shadow-[0_30px_80px_rgba(0,0,0,.3)] max-[640px]:p-[24px_20px]"
      >
        <AiGeneratingView />
      </div>
    </div>
  )
}
