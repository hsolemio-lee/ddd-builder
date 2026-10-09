import { useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check } from 'lucide-react';
import type { Stage } from '../types';
import { steps } from '../workflow';
import { lessons, references, documentationGuide } from '../learning';
import Modal from './Modal';

export default function LearningGuide({
  initialStage,
  onClose,
  onPractice,
}: {
  initialStage: Stage;
  onClose: () => void;
  onPractice: (stage: Stage) => void;
}) {
  const [selected, setSelected] = useState(initialStage);
  const [answers, setAnswers] = useState<Partial<Record<Stage, number>>>({});
  const index = steps.findIndex((step) => step.id === selected);
  const step = steps[index];
  const lesson = lessons[selected];
  const answer = answers[selected];
  const answered = answer !== undefined;

  function select(stage: Stage) {
    setSelected(stage);
    document
      .getElementById('learning-top')
      ?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <Modal title="DDD 학습 가이드" className="learning-modal" onClose={onClose}>
      <div className="learning-layout">
        <nav className="learning-nav" aria-label="학습 단계">
          <p>
            <BookOpen size={16} /> 이론에서 실습으로
          </p>
          {steps.map((item, i) => (
            <button
              type="button"
              key={item.id}
              aria-current={selected === item.id ? 'page' : undefined}
              onClick={() => select(item.id)}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {item.title}
            </button>
          ))}
          <small>
            어느 단계에서든 시작하고, 새롭게 배운 내용은 앞 단계에 반영하세요.
          </small>
        </nav>
        <article className="learning-article" aria-label={`${step.title} 학습`}>
          <div id="learning-top" className="learning-intro">
            <span className="learning-eyebrow">
              STEP {index + 1} · {step.english}
            </span>
            <h3>{step.title}</h3>
            <p>{lesson.goal}</p>
          </div>
          <details className="learning-overview">
            <summary>처음이라면: DDD와 이 보드의 전체 흐름</summary>
            <p>
              DDD(Domain-Driven Design, 도메인 주도 설계)는 업무 전문가와
              개발자가 함께 언어와 규칙을 발견하고 소프트웨어 모델에 반영하는
              접근입니다. 전략적 설계는 중요한 업무 영역과 모델의 경계를, 전술적
              설계는 그 안의 엔티티·값 객체·애그리게이트와 행동을 다룹니다.
            </p>
            <p>
              문제와 언어 → 사건과 흐름 → 모델의 경계 → 일관성과 규칙 → 구현과
              검증을 오가며 탐색합니다. EventStorming은 이 과정에 사용할 수 있는
              협업 방법입니다. 다섯 단계를 채웠다고 설계가 완성되는 것은
              아닙니다.
            </p>
            <p>
              아래 주문 예시는 학습용 가정입니다. 팀의 실제 정책으로 받아들이기
              전에 업무 담당자의 사례로 확인하세요.
            </p>
            <p>
              카드 추가로 아이디어를 기록하고 카드를 선택해 편집합니다. 조회
              권한에서는 상세만 확인할 수 있습니다. 카드 보기의 위·아래 화살표로
              순서를 바꾸고, 카드 연결로 흐름·관련·선행 조건을 표현하세요.
              컨텍스트의 경계 보기에서 카드를 분류하고, 결과 내보내기로 팀의
              기록을 공유할 수 있습니다.
            </p>
          </details>
          <section className="learning-section">
            <h4>핵심 이론</h4>
            {lesson.concepts.map((concept) => (
              <div className="learning-concept" key={concept.title}>
                <h5>{concept.title}</h5>
                <p>{concept.body}</p>
              </div>
            ))}
          </section>
          <section className="learning-section learning-example">
            <h4>주문 도메인으로 이해하기</h4>
            <p>{lesson.example}</p>
          </section>
          {lesson.fieldExamples && (
            <details className="learning-section">
              <summary>애그리게이트 항목별 작성 예시</summary>
              <p className="learning-note">
                주문과 생산계획 예시는 학습용 가정입니다. 실제 정책으로
                저장하거나 합의하기 전에 업무 담당자에게 확인하세요.
              </p>
              {lesson.fieldExamples.map((f) => (
                <div className="learning-concept" key={f.label}>
                  <h5>{f.label}</h5>
                  <p>{f.help}</p>
                  <p>예: {f.example}</p>
                </div>
              ))}
            </details>
          )}
          <details className="learning-section">
            <summary>AI 구현을 위한 문서 작성과 운영</summary>
            <p>{documentationGuide.goal}</p>
            <p className="learning-note">{documentationGuide.principle}</p>
            <h5>추천 문서</h5>
            <ul>
              {documentationGuide.files.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code> — {f.purpose}
                </li>
              ))}
            </ul>
            <h5>반복해서 검토하기</h5>
            <ol>
              {documentationGuide.workflow.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
            <h5>가상의 생산계획 규칙과 사례</h5>
            <p className="learning-note">{documentationGuide.example.note}</p>
            <p>
              {documentationGuide.example.ruleId} · 제안:{' '}
              {documentationGuide.example.statement}
            </p>
            <p>조건: {documentationGuide.example.condition}</p>
            <p>위반 결과: {documentationGuide.example.violation}</p>
            <p>허용 대안: {documentationGuide.example.exceptions}</p>
            <p>미결정: {documentationGuide.example.unresolved}</p>
            <p>Given: {documentationGuide.example.scenario.given}</p>
            <p>When: {documentationGuide.example.scenario.when}</p>
            <p>Then: {documentationGuide.example.scenario.then}</p>
            <h5>문서 품질을 확인할 질문</h5>
            <ul>
              {documentationGuide.review.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
          <section className="learning-section">
            <h4>보드에서 실습하기</h4>
            <ol>
              {lesson.practice.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
          </section>
          <section className="learning-section learning-pitfalls">
            <h4>흔한 오해와 주의할 점</h4>
            <ul>
              {lesson.pitfalls.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
          <section className="learning-section">
            <h4>팀과 함께 검토할 질문</h4>
            <ul className="learning-review">
              {lesson.review.map((text) => (
                <li key={text}>
                  <Check size={16} />
                  {text}
                </li>
              ))}
            </ul>
            <p className="learning-note">
              가설·제안·합의 상태로 판단을 구분하고, 합의에는 검토자와 사례 등
              근거를 남기세요. 설계 점검은 입력과 연결의 빈틈을 찾는 보조
              수단입니다.
            </p>
          </section>
          <section
            className="learning-section learning-quiz"
            aria-label="이해 확인 문제"
          >
            <h4>이해 확인</h4>
            <fieldset>
              <legend>{lesson.quiz.question}</legend>
              {lesson.quiz.options.map((option, i) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={`quiz-${selected}`}
                    checked={answer === i}
                    onChange={() =>
                      setAnswers((previous) => ({ ...previous, [selected]: i }))
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
            {answered && (
              <div className="learning-feedback" role="status">
                <strong>
                  {answer === lesson.quiz.answer
                    ? '맞아요.'
                    : '다시 생각해 보세요.'}
                </strong>
                <p>{lesson.quiz.explanation}</p>
              </div>
            )}
            <p className="learning-note">
              답변은 이 창을 닫으면 초기화됩니다. 점수나 프로젝트의 설계 상태에
              반영하지 않습니다.
            </p>
          </section>
          <section className="learning-section">
            <h4>더 깊이 읽기</h4>
            <ul className="learning-references">
              {references.map((reference) => (
                <li key={reference.url}>
                  <a
                    href={reference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {reference.title} ↗
                  </a>
                  <p>{reference.description}</p>
                </li>
              ))}
            </ul>
          </section>
          <div className="learning-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => onPractice(selected)}
            >
              이 단계 보드에서 실습 <ArrowRight size={15} />
            </button>
            <div className="learning-pagination">
              <button
                type="button"
                className="button"
                disabled={index === 0}
                onClick={() => select(steps[index - 1].id)}
              >
                <ArrowLeft size={15} /> 이전 학습
              </button>
              <button
                type="button"
                className="button"
                disabled={index === steps.length - 1}
                onClick={() => select(steps[index + 1].id)}
              >
                다음 학습 <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </article>
      </div>
    </Modal>
  );
}
