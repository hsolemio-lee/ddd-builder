import { useState } from 'react';
import type { Card, Stage } from '../types';
import { reviewBoard } from '../../shared/design.mjs';
import { steps } from '../workflow';
const prompts: Record<Stage, string> = {
  discovery:
    '고객·운영자의 실제 사례로 문제와 용어를 확인했나요? 가설과 확인된 사실을 구분해 보세요.',
  events:
    '사건의 시간 순서와 정상·예외 경로가 설명되나요? 처음에는 사건만 정리해도 좋아요. 필요한 명령·정책을 점차 연결하세요.',
  contexts:
    '같은 용어의 의미가 달라지는 경계, 정보의 소유권과 팀 책임이 드러나나요? 컨텍스트를 배포 서비스와 자동으로 동일시하지 마세요.',
  aggregates:
    '불변식이 같은 트랜잭션 안에서 지켜지나요? 외부 애그리게이트는 ID로 참조하고 여러 경계의 흐름은 별도 진행·보상으로 연결하세요.',
  tasks:
    '업무 시나리오와 불변식을 확인할 완료 기준이 있나요? 관련 연결로 설계 근거를 남겨 보세요.',
};
export default function DesignReview({
  cards,
  stage,
  onOpen,
}: {
  cards: Card[];
  stage: Stage;
  onOpen: (card: Card) => void;
}) {
  const [scope, setScope] = useState('stage');
  const review = reviewBoard(cards);
  const issues = review.issues.filter(
    (i) => scope === 'all' || i.stage === stage,
  );
  return (
    <section className="design-review" aria-label="설계 점검 결과">
      <div className="review-summary">
        <strong>설계 검토</strong>
        <span>가설 {review.counts.hypothesis}</span>
        <span>제안 {review.counts.proposed}</span>
        <span>합의 {review.counts.agreed}</span>
        <span>미해결 질문 {review.unansweredQuestions}</span>
      </div>
      <p>{prompts[stage]}</p>
      <p className="field-help">{review.note}</p>
      <label className="review-scope">
        검토 범위
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="stage">현재 단계</option>
          <option value="all">프로젝트 전체</option>
        </select>
      </label>
      {issues.length === 0 ? (
        <p>
          자동 점검에서 발견한 빈틈이 없습니다. 실제 업무 사례와 경계의 타당성은
          함께 검토해 주세요.
        </p>
      ) : (
        <details open>
          <summary>검토할 항목 {issues.length}개</summary>
          <ul className="review-issues">
            {issues.map((issue, i) => {
              const card = cards.find((c) => c.id === issue.cardId)!;
              return (
                <li key={`${issue.cardId}:${issue.code}:${i}`}>
                  <button onClick={() => onOpen(card)}>
                    <span>
                      {steps.find((s) => s.id === issue.stage)?.title} ·{' '}
                      {card.title}
                    </span>
                    <strong>{issue.message}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
