import { ClassTile, ClassTileCta } from '@/components/classroom/teacher/ClassTile'
import { ClassTileMenu } from '@/components/classroom/teacher/ClassTileMenu'
import { LOCKED_TILE_THEME } from '@/lib/classTile'
import { gradeLabelOf } from '@/lib/subject'
import type { ManagedClassroom } from '@/types/teacher'

interface LockedClassCardProps {
  classroom: ManagedClassroom
  /** 학생 수 — 닫아 둔 학급도 학생은 그대로 남아 있다 */
  studentCount?: number
  /** 과제 진행률 0~100. `null` = 낼 과제가 아직 없다 */
  progress?: number | null
  onStart: () => void
  onDelete: () => void
}

/**
 * 닫혀있는 학급 카드 — 레퍼런스 teacher.html `renderLockedCards` 의 `.pk-card.pk-card-locked`.
 *
 * 진행 중인 학급과 **같은 틀**(`ClassTile`)이고 색만 빠진다 — 이름·학생 수·진행률까지 자리가
 * 같아서 한 그리드에 나란히 서도 어긋나지 않는다. 무채색이라 "지금 진행 중이 아니다"가
 * 한눈에 갈라진다.
 *
 * 버튼만 파랑(--primary)으로 남긴다 — 카드에서 유일한 색이라 "학급을 열까요?"로 눈이 간다.
 */
export function LockedClassCard({
  classroom,
  studentCount,
  progress,
  onStart,
  onDelete,
}: LockedClassCardProps) {
  return (
    <ClassTile
      locked
      theme={LOCKED_TILE_THEME}
      pill={gradeLabelOf(classroom.grades)}
      title={classroom.name}
      studentCount={studentCount}
      progress={progress}
      topRight={
        // 삭제는 OWNER 만 가능하다 — 아니면 메뉴 자체를 열지 않는다
        classroom.myRole === 'OWNER' ? (
          <ClassTileMenu items={[{ label: '학급 삭제', onSelect: onDelete, danger: true }]} />
        ) : undefined
      }
      cta={
        <ClassTileCta label="학급을 열까요?" color="var(--color-primary)" onClick={onStart} />
      }
    />
  )
}
