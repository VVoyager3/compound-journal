import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentQuestions, scoreAssessment } from '../src/assessment.ts';

test('status questionnaires cover every dimension with 30 or 60 concrete questions', () => {
  const quick = assessmentQuestions(30);
  const full = assessmentQuestions(60);
  assert.equal(quick.length, 30);
  assert.equal(full.length, 60);
  for (const dimension of ['energy', 'mind', 'connection', 'progress', 'play']) {
    assert.equal(quick.filter((question) => question.dimension === dimension).length, 6);
    assert.equal(full.filter((question) => question.dimension === dimension).length, 12);
  }
  assert.equal(new Set(full.map((question) => question.id)).size, 60);
});

test('status scoring handles positive and reverse questions without asking users to guess a score', () => {
  const questions = assessmentQuestions(60);
  const healthyAnswers = Object.fromEntries(questions.map((question) => [question.id, question.reverse ? 1 : 5]));
  const strugglingAnswers = Object.fromEntries(questions.map((question) => [question.id, question.reverse ? 5 : 1]));
  assert.deepEqual(scoreAssessment(questions, healthyAnswers), { energy: 100, mind: 100, connection: 100, progress: 100, play: 100 });
  assert.deepEqual(scoreAssessment(questions, strugglingAnswers), { energy: 20, mind: 20, connection: 20, progress: 20, play: 20 });
  assert.throws(() => scoreAssessment(questions, {}), /回答全部问题/);
});
