import { useEffect, useState } from 'react'
import { ModalShell, MODAL_SUB } from '@/components/common/ModalShell'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Icon } from '@/components/common/Icon'
import { inviteApi } from '@/services/api/inviteApi'
import { useClassroomsStore } from '@/stores/useClassroomsStore'
import { useToastStore } from '@/stores/useToastStore'
import { apiErrorMessage } from '@/lib/apiError'
import { INVITE_CODE_LENGTH, inviteCodeFrom, isInviteCodeComplete } from '@/lib/invite'
import type { InvitePreview } from '@/types/invite'

/**
 * 학급 참여 — 다른 선생님에게 받은 초대 코드로 그 학급의 **공동 관리자**가 된다.
 *
 * `/invite/:code` 화면(InviteAcceptPage)과 같은 일을 하지만 진입이 다르다. 그쪽은 링크를
 * 눌러서 들어오는 길이라 코드가 URL 에 이미 있고, 여기는 **코드만 전달받았을 때** 쓰는 길이다
 * (링크를 잃어버렸거나, 메신저에서 코드 여섯 자만 받은 경우). 그래서 이 모달의 일은
 * 사실상 "코드를 받아 그 화면과 같은 수락을 부르는 것" 하나뿐이다.
 *
 * 수락 전에 `previewInvite` 로 **어느 학급인지 · 지금 쓸 수 있는지**를 먼저 보여준다.
 * 못 쓰는 코드도 200 으로 오므로(`usable:false` + `reason`) 상태코드가 아니라 그 필드로 가른다.
 */
export function JoinClassModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadClassrooms = useClassroomsStore((s) => s.load)
  const showToast = useToastStore((s) => s.show)

  const complete = isInviteCodeComplete(code)

  /*
    코드가 여섯 자로 채워지면 미리보기를 부른다. 실패는 조용히 넘긴다 —
    이건 **안내를 좋게 하는 정보**이지 수락의 전제 조건이 아니다(레이트리밋 429 로 못 읽었다고
    참여를 막으면 안 된다). 최종 판정은 수락 시점의 서버가 한다.
  */
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!complete) {
      setPreview(null)
      return
    }
    let cancelled = false
    setChecking(true)
    void inviteApi
      .previewInvite(code)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null))
      .finally(() => !cancelled && setChecking(false))
    return () => {
      cancelled = true
    }
  }, [code, complete])

  /** 못 쓰는 코드 */
  const blocked = preview !== null && !preview.usable
  /**
   * 학생용 코드 — 선생님이 넣으면 서버가 `400 student-info-required` 로 돌려보낸다.
   * 미리보기로 알 수 있으니 보내 보기 전에 세운다.
   */
  const studentInvite = preview?.type === 'STUDENT'
  const canJoin = complete && !busy && !blocked && !studentInvite

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const res = await inviteApi.acceptInvite(code)
      // 참여한 학급이 바로 목록에 보여야 한다 — 새로고침을 시키지 않는다
      await loadClassrooms()
      showToast(`${res.classroomName} 학급에 참여했어요`)
      onClose()
    } catch (e) {
      setError(apiErrorMessage(e, '참여하지 못했어요. 코드를 다시 확인해 주세요.'))
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      label="학급 참여"
      title={<h2 className="text-[1.3rem] font-black">학급 참여</h2>}
    >
      <p className={MODAL_SUB}>
        다른 선생님께 받은 초대 코드를 넣으면
        <br />그 학급을 <b className="text-primary">함께 관리하는 선생님</b>이 돼요.
      </p>

      <label className="block">
        <span className="mb-2 block text-[.95rem] font-black">초대 코드</span>
        <Input
          value={code}
          /*
            링크를 통째로 붙여넣어도 받는다 (`inviteCodeFrom`). maxLength 를 걸지 않는 이유가
            이것이다 — 6자로 잘라 버리면 링크가 주소 앞부분만 남아 코드를 못 찾는다.
          */
          onChange={(e) => setCode(inviteCodeFrom(e.target.value))}
          placeholder={'A'.repeat(INVITE_CODE_LENGTH)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="px-4 py-3 text-center font-mono text-[1.15rem] font-black uppercase tracking-[.4em] focus:bg-white"
        />
      </label>

      {/*
        코드가 채워진 뒤의 한 칸 — 조회 중 · 어느 학급인지 · 왜 못 쓰는지가 **같은 자리**에서
        바뀐다. 상태마다 다른 자리에 띄우면 글자가 채워질 때 모달 높이가 널뛴다.
      */}
      {complete && (
        <div className="mt-3.5 min-h-[62px] rounded-2xl bg-canvas p-3.5">
          {checking ? (
            <p className="text-[.9rem] font-semibold text-ink-mute">코드를 확인하는 중…</p>
          ) : blocked ? (
            <>
              <p className="text-[.92rem] font-black text-danger">
                {blockedMessage(preview.reason)}
              </p>
              <p className="mt-1 text-[.86rem] font-semibold text-ink-soft">
                초대한 선생님께 새 코드를 받아주세요.
              </p>
            </>
          ) : studentInvite ? (
            <>
              <p className="text-[.92rem] font-black text-danger">학생용 초대 코드예요.</p>
              <p className="mt-1 text-[.86rem] font-semibold text-ink-soft">
                선생님이 참여하려면 <b className="font-black text-ink">선생님용</b> 코드가 필요해요.
              </p>
            </>
          ) : preview ? (
            <>
              <p className="text-[.92rem] font-bold text-ink-soft">
                <b className="font-black text-ink">{preview.classroomName}</b> 학급의 선생님
                초대예요.
              </p>
              <p className="mt-1 text-[.86rem] font-semibold text-ink-soft">
                참여하면 이 학급이 내 학급 목록에 추가돼요.
              </p>
            </>
          ) : (
            /* 미리보기를 못 읽었다 — 막지 않는다. 서버가 수락할 때 다시 검증한다 */
            <p className="text-[.88rem] font-semibold text-ink-mute">
              코드 정보를 불러오지 못했어요. 그대로 참여해 볼 수 있어요.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3.5 whitespace-pre-line rounded-2xl bg-danger-soft p-3.5 text-[.9rem] font-bold text-danger">
          {error}
        </p>
      )}

      <Button className="mt-5 w-full" disabled={!canJoin} onClick={() => void join()}>
        <Icon name="mail" className="h-[17px] w-[17px]" />
        {busy ? '참여하는 중…' : '학급에 참여하기'}
      </Button>
    </ModalShell>
  )
}

/** 미리보기가 알려준 "왜 못 쓰는지"를 사람 말로 (서버 reason 은 대문자 코드다) */
function blockedMessage(reason: InvitePreview['reason']): string {
  switch (reason) {
    case 'EXPIRED':
      return '이 초대 코드는 기한이 지났어요.'
    case 'USED_UP':
      return '이 초대 코드는 정원이 다 찼어요.'
    case 'REVOKED':
      return '이 초대 코드는 회수됐어요.'
    default:
      return '지금은 이 초대 코드를 쓸 수 없어요.'
  }
}
