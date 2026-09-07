import { ClassTile, ClassTileCta } from '@/components/classroom/teacher/ClassTile'
import { ClassTileMenu, type TileMenuItem } from '@/components/classroom/teacher/ClassTileMenu'
import { classTileTheme } from '@/lib/classTile'
import { gradeLabelOf } from '@/lib/subject'
import type { ManagedClassroom } from '@/types/teacher'

interface ClassProgressCardProps {
  classroom: ManagedClassroom
  /** 학생 수 — 목록 API 에 없어 부모가 학급 상세로 채운다. 아직 못 받았으면 생략 */
  studentCount?: number
  /** 과제 진행률 0~100. `null` = 낼 과제가 아직 없다 (0% 와 구분해 `—` 로 적힌다) */
  progress?: number | null
  onEnter: () => void
  onManage: () => void
  onClose: () => void
  onDelete: () => void
}

/**
 * 진행 중인 학급 카드 — 레퍼런스 teacher.html `renderProgressCards` 의 `.pk-card` 이관.
 *
 * 문구는 전부 **학급**이다(예전 "수업 참여 / 수업 닫기 / 수업 삭제"). 이 카드가 가리키는 것은
 * `Classroom` 이고, 그 안에서 여는 실시간 세션이 '수업'이다 — 카드의 '닫기'가 오늘 수업을
 * 끝내는 것인지 학급을 접는 것인지 구분되지 않았다.
 *
 * 예전에는 옛 `.progress-card`(큰 제목 + 마스코트 + 색 버튼)를 쓰고 있었다. ref 가 세 화면
 * (내 학급 · 학생 관리 진입 · 과제 관리 진입)의 카드를 **같은 틀로 통일**하면서 이쪽도 함께
 * 바뀌었다 — 같은 학급이 화면마다 다르게 보이지 않아야 한다. 공통 틀은 `ClassTile` 이다.
 *
 * 자리 배치(ref): 알약 = 학년 · 큰 글씨 = 학급 이름 · 학생 수 · 과제 진행률 · 맨 아래 꽉 찬 버튼.
 */
export function ClassProgressCard({
  classroom,
  studentCount,
  progress,
  onEnter,
  onManage,
  onClose,
  onDelete,
}: ClassProgressCardProps) {
  const theme = classTileTheme(classroom.id)

  const items: TileMenuItem[] = [
    { label: '학급 관리', onSelect: onManage },
    { label: '학급 닫기', onSelect: onClose },
    // 삭제는 OWNER 만 가능하다 (서버가 `owner-only` 로 거절) — 안 되는 메뉴를 보여주지 않는다
    ...(classroom.myRole === 'OWNER'
      ? [{ label: '학급 삭제', onSelect: onDelete, danger: true }]
      : []),
  ]

  return (
    <ClassTile
      theme={theme}
      pill={gradeLabelOf(classroom.grades)}
      title={classroom.name}
      studentCount={studentCount}
      progress={progress}
      topRight={<ClassTileMenu items={items} />}
      cta={<ClassTileCta label="학급 들어가기" color={theme.ink} onClick={onEnter} />}
    />
  )
}
