import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'ddd-builder.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS cards_project ON cards(project_id); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  const allProjects = db.prepare('SELECT json FROM projects ORDER BY rowid');
  const allCards = db.prepare('SELECT json FROM cards ORDER BY rowid');
  const getProject = db.prepare('SELECT json FROM projects WHERE id=?');
  const getCard = db.prepare('SELECT json FROM cards WHERE id=?');
  const projectWrite = db.prepare(
    'INSERT INTO projects(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
  );
  const cardWrite = db.prepare(
    'INSERT INTO cards(id,project_id,json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
  );
  const parse = (row) => (row ? JSON.parse(row.json) : undefined);
  const store = {
    db,
    state: () => ({
      projects: allProjects.all().map(parse),
      cards: allCards.all().map(parse),
    }),
    project: (id) => parse(getProject.get(id)),
    card: (id) => parse(getCard.get(id)),
    saveProject: (p) => projectWrite.run(p.id, JSON.stringify(p)),
    saveCard: (c) => cardWrite.run(c.id, c.projectId, JSON.stringify(c)),
    deleteProject: (id) =>
      db.prepare('DELETE FROM projects WHERE id=?').run(id),
    deleteCard: (id) => db.prepare('DELETE FROM cards WHERE id=?').run(id),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
  if (!db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()) {
    store.transaction(() => {
      seedSample(store, '시작 예제');
      db.prepare(
        "INSERT INTO metadata(key,value) VALUES ('initialized','1')",
      ).run();
    });
  }
  return store;
}

export function record(fields, user) {
  const time = new Date().toISOString();
  return {
    ...fields,
    id: randomUUID(),
    revision: 1,
    createdAt: time,
    updatedAt: time,
    updatedBy: user,
  };
}

export function seedSample(
  store,
  user,
  name = '온라인 주문 서비스',
  description = '문제 탐색부터 이벤트, 바운디드 컨텍스트, 애그리게이트와 실행 과제를 함께 설계해 보세요.',
) {
  const project = record({ name, description }, user);
  store.saveProject(project);
  const counts = {};
  function add(
    stage,
    kind,
    title,
    description = '',
    data = {},
    contextId = null,
  ) {
    const index = counts[stage] || 0;
    counts[stage] = index + 1;
    const card = record(
      {
        projectId: project.id,
        stage,
        kind,
        title,
        description,
        contextId,
        data,
        position: index,
      },
      user,
    );
    store.saveCard(card);
    return card;
  }
  add(
    'discovery',
    'problem',
    '주문 상태를 쉽게 확인하고 싶다',
    '고객은 결제 이후 배송 진행 상태를 확인하기 어렵다.',
  );
  add('discovery', 'actor', '고객', '상품을 주문하고 배송 상태를 조회한다.');
  add(
    'discovery',
    'term',
    '주문',
    '고객이 구매 의사를 확정한 상품과 수량의 묶음.',
  );
  add(
    'events',
    'event',
    '주문이 접수되었다',
    '주문번호와 주문 항목이 확정되었다.',
  );
  add('events', 'command', '주문 접수', '상품과 수량, 배송지를 제출한다.');
  add('events', 'actor', '고객', '주문 접수 명령을 요청한다.');
  add(
    'events',
    'policy',
    '결제 완료 시 배송을 요청한다',
    '결제 완료 이벤트를 받아 배송 요청 명령을 실행한다.',
  );
  add(
    'events',
    'question',
    '재고 부족 시 주문을 언제 취소할까?',
    '예약 만료와 환불 정책을 확인한다.',
  );
  const order = add(
    'contexts',
    'context',
    '주문',
    '주문 접수와 취소, 주문 상태를 관리한다.',
    {
      relationships: '결제 컨텍스트에 결제 요청을 전달하고 결제 결과를 받는다.',
    },
  );
  add('contexts', 'context', '결제', '결제 승인과 환불을 책임진다.', {
    relationships: '주문 컨텍스트에 결제 완료·실패 이벤트를 발행한다.',
  });
  add(
    'aggregates',
    'aggregate',
    '주문',
    '주문의 일관성 경계를 정의한다.',
    {
      root: 'Order',
      entities: 'OrderLine',
      valueObjects: 'Money, ShippingAddress',
      invariants:
        '주문 항목은 1개 이상이어야 한다. 결제 완료 주문의 금액은 변경할 수 없다.',
    },
    order.id,
  );
  add(
    'tasks',
    'task',
    '주문 용어 합의',
    '주문·결제·배송의 상태와 용어를 팀과 합의한다.',
    { assignee: '', done: false },
    order.id,
  );
  add(
    'tasks',
    'task',
    '결제 이벤트 계약 정의',
    '이벤트 이름과 필수 필드를 정한다.',
    { assignee: '', done: false },
  );
  add(
    'tasks',
    'task',
    '주문 불변식 검증',
    '핵심 불변식의 테스트 시나리오를 작성한다.',
    { assignee: '', done: true },
    order.id,
  );
  return project;
}
